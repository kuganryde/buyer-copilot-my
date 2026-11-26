"""Document interpreter: bilingual glossary, title-search parser and retrieval.

Security notes:
  * Uploaded text is UNTRUSTED. It is parsed with bounded regexes (no catastrophic
    backtracking patterns, input length capped) and is never executed, templated
    into SQL, or forwarded to an LLM as instructions.
  * Retrieval is deterministic by default (local TF-IDF). The pgvector backend is
    used only when an embedding function is injected — embeddings are computed
    server-side and queries are fully parameterised.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol

MAX_DOC_CHARS = 200_000

GLOSSARY: dict[str, dict[str, str]] = {
    "carian rasmi": {"en": "Official Title Search", "explain_en": "Certified extract from the Land Office showing the registered owner, charges, caveats and restrictions. Always do this before paying.", "explain_ms": "Cabutan rasmi dari Pejabat Tanah yang menunjukkan pemilik berdaftar, gadaian, kaveat dan sekatan."},
    "geran": {"en": "Registry/Land Office title (grant)", "explain_en": "Document of title. 'Geran Mukim' is a Land Office title; 'Geran' (GRN) is a Registry title.", "explain_ms": "Dokumen hakmilik tanah."},
    "hakmilik strata": {"en": "Strata title", "explain_en": "Separate title for a parcel in a subdivided building (condo/apartment).", "explain_ms": "Hakmilik bagi petak dalam bangunan berstrata."},
    "pajakan": {"en": "Leasehold", "explain_en": "Land held for a fixed term (e.g. 99 years) from the State. Value and financing fall as the expiry nears.", "explain_ms": "Tanah dipegang bagi tempoh tetap daripada Pihak Berkuasa Negeri."},
    "selama-lamanya": {"en": "Freehold (in perpetuity)", "explain_en": "No expiry date on the title.", "explain_ms": "Pegangan kekal tanpa tarikh luput."},
    "gadaian": {"en": "Charge (mortgage)", "explain_en": "A bank holds security over the land. Must be redeemed before transfer to you.", "explain_ms": "Bank memegang cagaran ke atas tanah; perlu ditebus sebelum pindah milik."},
    "kaveat": {"en": "Caveat", "explain_en": "A registered claim that blocks dealings. Private caveats must be withdrawn; Registrar's caveats freeze the land.", "explain_ms": "Tuntutan berdaftar yang menghalang urusniaga."},
    "sekatan kepentingan": {"en": "Restriction in interest", "explain_en": "Title condition, e.g. 'cannot be transferred without State consent'. Adds time and cost.", "explain_ms": "Syarat hakmilik, contoh: tidak boleh dipindah milik tanpa kebenaran Pihak Berkuasa Negeri."},
    "syarat nyata": {"en": "Express condition", "explain_en": "Permitted use of the land (e.g. 'Bangunan Kediaman' = residential building).", "explain_ms": "Syarat kegunaan tanah."},
    "kategori kegunaan tanah": {"en": "Land-use category", "explain_en": "Pertanian (agriculture), Bangunan (building) or Perusahaan (industry). Changing it needs State approval.", "explain_ms": "Pertanian, Bangunan atau Perusahaan."},
    "rizab melayu": {"en": "Malay Reserve", "explain_en": "Land that can only be held by persons qualifying as Malay under state law.", "explain_ms": "Tanah yang hanya boleh dimiliki oleh orang Melayu seperti ditakrif undang-undang negeri."},
    "borang 14a": {"en": "Memorandum of Transfer (MOT)", "explain_en": "Statutory form that transfers ownership. Stamp duty is assessed on it.", "explain_ms": "Borang pindah milik berkanun; duti setem ditaksir ke atasnya."},
    "milikan kosong": {"en": "Vacant possession", "explain_en": "Handover of the property empty, with keys, on completion.", "explain_ms": "Penyerahan hartanah dalam keadaan kosong bersama kunci."},
    "cukai tanah": {"en": "Quit rent", "explain_en": "Annual land tax to the State Land Office.", "explain_ms": "Cukai tahunan kepada Pejabat Tanah."},
    "cukai pintu": {"en": "Assessment tax", "explain_en": "Annual property tax to the local council (PBT).", "explain_ms": "Cukai taksiran kepada Pihak Berkuasa Tempatan."},
    "pemegang amanah": {"en": "Stakeholder", "explain_en": "Lawyer who holds your deposit in a client account until SPA conditions are met.", "explain_ms": "Peguam yang memegang deposit sehingga syarat perjanjian dipenuhi."},
    "duti setem": {"en": "Stamp duty", "explain_en": "Tax on instruments (MOT, loan agreement) payable to LHDN via STAMPS.", "explain_ms": "Cukai ke atas surat cara seperti borang pindah milik dan perjanjian pinjaman."},
}

_MALAY_MARKERS = {"dan", "yang", "tanah", "hakmilik", "pemilik", "untuk", "dengan", "tidak", "ini",
                  "saya", "rumah", "harga", "pajakan", "bayaran", "perjanjian", "berapa", "boleh"}


def detect_language(text: str) -> str:
    """Cheap, deterministic EN/MS detector used to match reply language."""
    tokens = re.findall(r"[a-zA-Z\-]+", text.lower()[:5000])
    if not tokens:
        return "en"
    ratio = sum(t in _MALAY_MARKERS for t in tokens) / len(tokens)
    return "ms" if ratio >= 0.08 else "en"


# --------------------------------------------------------------- title parser

_DATE = r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})"
_PATTERNS: dict[str, re.Pattern[str]] = {
    "title_no": re.compile(r"\b(GRN|GM|PN|PM|HSD|HSM|Geran|Pajakan Negeri|Pajakan Mukim)\s*[:\-]?\s*(\d{1,8})\b", re.I),
    "lot_no": re.compile(r"\b(?:Lot|PT)\s*(?:No\.?)?\s*[:\-]?\s*(\d{1,8})\b", re.I),
    "lease_expiry": re.compile(r"(?:tarikh\s+luput|tamat\s+tempoh|lease\s+expir\w*)\D{0,20}" + _DATE, re.I),
    "lease_years": re.compile(r"(?:pajakan|lease)\D{0,20}(\d{2,3})\s*(?:tahun|years)", re.I),
    "land_use": re.compile(r"kategori\s+kegunaan\s+tanah\s*[:\-]?\s*(pertanian|bangunan|perusahaan)", re.I),
    "proprietor": re.compile(r"(?:tuan\s+punya|pemilik\s+berdaftar|registered\s+proprietor)\s*[:\-]\s*([A-Z][A-Z .'@/-]{2,80})", re.I),
}
_PRESENCE = {
    "has_existing_charge": re.compile(r"\b(gadaian|charge\s+(?:no|to))\b", re.I),
    "has_private_caveat": re.compile(r"\bkaveat\s+persendirian|private\s+caveat\b", re.I),
    "has_registrar_caveat": re.compile(r"\bkaveat\s+pendaftar|registrar'?s\s+caveat\b", re.I),
    "is_malay_reserve": re.compile(r"\b(rizab\s+melayu|malay\s+reserv\w*)\b", re.I),
    "is_freehold": re.compile(r"\b(selama-?lamanya|kekal|freehold|in\s+perpetuity)\b", re.I),
    "is_leasehold": re.compile(r"\b(pajakan|leasehold)\b", re.I),
}
_RESTRICTION = re.compile(r"sekatan\s+kepentingan\s*[:\-]?\s*(.{0,240})", re.I | re.S)


def parse_title_search(text: str) -> dict[str, Any]:
    """Extract structured facts from OCR'd/pasted official title search text.

    Output feeds `guardrails.ListingFacts`; every extracted field carries the
    matched snippet so the buyer can verify the machine reading (HITL).
    """
    if len(text) > MAX_DOC_CHARS:
        raise ValueError("document too large")
    facts: dict[str, Any] = {}
    evidence: dict[str, str] = {}

    for key, pat in _PATTERNS.items():
        m = pat.search(text)
        if not m:
            continue
        evidence[key] = m.group(0)[:160]
        if key == "lease_expiry":
            d, mth, y = (int(x) for x in m.groups())
            try:
                facts[key] = date(y, mth, d).isoformat()
            except ValueError:
                evidence[key] += " (unparseable date)"
        elif key == "title_no":
            facts[key] = f"{m.group(1).upper()} {m.group(2)}"
        elif key == "land_use":
            facts["land_use_category"] = m.group(1).capitalize()
        else:
            facts[key] = m.group(m.lastindex or 1).strip()

    for key, pat in _PRESENCE.items():
        m = pat.search(text)
        facts[key] = bool(m)
        if m:
            evidence[key] = m.group(0)

    if facts.pop("is_leasehold") and not facts.get("is_freehold"):
        facts["tenure"] = "LEASEHOLD"
    elif facts.get("is_freehold"):
        facts["tenure"] = "FREEHOLD"
    else:
        facts["tenure"] = "UNKNOWN"
    facts.pop("is_freehold", None)

    m = _RESTRICTION.search(text)
    if m and m.group(1).strip() and not re.match(r"(tiada|nil|none)\b", m.group(1).strip(), re.I):
        facts["has_restriction_in_interest"] = True
        facts["restriction_text"] = " ".join(m.group(1).split())[:200]
    else:
        facts["has_restriction_in_interest"] = False

    terms = [t for t in GLOSSARY if t in text.lower()]
    return {
        "facts": facts,
        "evidence": evidence,
        "glossary_hits": {t: GLOSSARY[t] for t in terms},
        "language": detect_language(text),
        "requires_human_verification": True,
    }


# --------------------------------------------------------------- retrieval

@dataclass(frozen=True)
class Passage:
    id: str
    title: str
    text: str
    source_url: str | None = None


class Retriever(Protocol):
    def search(self, query: str, k: int = 5) -> list[tuple[Passage, float]]: ...


_TOKEN = re.compile(r"[a-z0-9\-]+")


def _tok(s: str) -> list[str]:
    return _TOKEN.findall(s.lower())


class LocalTfidfRetriever:
    """Dependency-free fallback; good enough for a glossary/directory corpus of <10k passages."""

    def __init__(self, passages: list[Passage]):
        self.passages = passages
        self.docs = [Counter(_tok(p.title + " " + p.text)) for p in passages]
        df: Counter[str] = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = max(len(passages), 1)
        self.idf = {t: math.log((n + 1) / (c + 1)) + 1 for t, c in df.items()}

    def search(self, query: str, k: int = 5) -> list[tuple[Passage, float]]:
        q = Counter(_tok(query[:2000]))
        scored = []
        for p, d in zip(self.passages, self.docs, strict=False):
            s = sum(q[t] * d[t] * self.idf.get(t, 0) ** 2 for t in q)
            if s > 0:
                norm = math.sqrt(sum((c * self.idf.get(t, 0)) ** 2 for t, c in d.items())) or 1
                scored.append((p, s / norm))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[: max(1, min(k, 20))]


class PgVectorRetriever:
    """pgvector backend. `embed` must return a list[float] matching the column dimension."""

    def __init__(self, conn_factory: Callable[[], Any], embed: Callable[[str], list[float]]):
        self.conn_factory = conn_factory
        self.embed = embed

    def search(self, query: str, k: int = 5) -> list[tuple[Passage, float]]:
        vec = self.embed(query[:2000])
        literal = "[" + ",".join(f"{float(x):.7f}" for x in vec) + "]"
        sql = (
            "SELECT id::text, title, body, source_url, 1 - (embedding <=> %s::vector) AS score "
            "FROM knowledge_chunks WHERE embedding IS NOT NULL "
            "ORDER BY embedding <=> %s::vector LIMIT %s"
        )
        with self.conn_factory() as conn, conn.cursor() as cur:
            cur.execute(sql, (literal, literal, max(1, min(k, 20))))
            return [(Passage(r[0], r[1], r[2], r[3]), float(r[4])) for r in cur.fetchall()]


def glossary_passages() -> list[Passage]:
    return [Passage(f"glossary:{k}", f"{k} — {v['en']}", f"{v['explain_en']} {v['explain_ms']}")
            for k, v in GLOSSARY.items()]


def explain(query: str, retriever: Retriever | None = None, k: int = 3) -> dict[str, Any]:
    retriever = retriever or LocalTfidfRetriever(glossary_passages())
    lang = detect_language(query)
    hits = retriever.search(query, k)
    return {
        "language": lang,
        "results": [{"id": p.id, "title": p.title, "text": p.text, "source_url": p.source_url,
                     "score": round(s, 4)} for p, s in hits],
        "disclaimer": DISCLAIMER[lang],
    }


DISCLAIMER = {
    "en": "This is general information, not legal, tax or valuation advice. Confirm every step "
    "with a licensed conveyancing lawyer before signing or paying.",
    "ms": "Ini maklumat umum, bukan nasihat undang-undang, cukai atau penilaian. Sahkan setiap "
    "langkah dengan peguam hartanah berlesen sebelum menandatangani atau membuat bayaran.",
}
