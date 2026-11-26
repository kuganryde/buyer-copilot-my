"""Deterministic fraud & risk guardrails for owner-direct property purchases.

Severity semantics (enforced by the state machine, not just displayed):
  BLOCK — the buyer CANNOT approve the current HITL gate until resolved.
          They may still request changes or reject (walk away).
  WARN  — approval allowed, but the buyer must acknowledge the flag.
  INFO  — educational.

Guardrails are rule-based on purpose: an LLM must never be the component that
decides whether a cash hand-over is safe.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Literal

Severity = Literal["BLOCK", "WARN", "INFO"]

SHORT_LEASE_BLOCK_YEARS = 30  # most banks will not finance; resale severely impaired
SHORT_LEASE_WARN_YEARS = 60  # financing tenure + resale value already affected
UNDER_DECLARATION_TOLERANCE = Decimal("0.10")


class Tenure(StrEnum):
    FREEHOLD = "FREEHOLD"  # Kekal / Selama-lamanya
    LEASEHOLD = "LEASEHOLD"  # Pajakan
    UNKNOWN = "UNKNOWN"


class PaymentMethod(StrEnum):
    CASH_BY_HAND = "CASH_BY_HAND"
    TRANSFER_TO_SELLER_PERSONAL = "TRANSFER_TO_SELLER_PERSONAL"
    TRANSFER_TO_LAWYER_CLIENT_ACCOUNT = "TRANSFER_TO_LAWYER_CLIENT_ACCOUNT"
    BANK_DRAFT_TO_LAWYER = "BANK_DRAFT_TO_LAWYER"


@dataclass(frozen=True)
class PaymentIntent:
    amount: Decimal
    method: PaymentMethod
    has_written_receipt: bool
    has_written_terms: bool  # signed letter of offer / SPA referencing this payment
    stakeholder_held: bool  # held by lawyer as stakeholder until conditions met


@dataclass
class ListingFacts:
    property_type: str = "RESIDENTIAL_HOUSE"
    official_title_search_done: bool = False
    title_search_date: date | None = None
    registered_owner_matches_seller: bool | None = None
    has_existing_charge: bool | None = None  # Gadaian
    has_private_caveat: bool | None = None  # Kaveat Persendirian
    has_registrar_caveat: bool | None = None  # Kaveat Pendaftar — dealings frozen
    has_restriction_in_interest: bool | None = None  # Sekatan Kepentingan
    restriction_text: str = ""
    is_malay_reserve: bool | None = None  # Tanah Rizab Melayu
    buyer_is_malay_as_defined: bool | None = None
    is_bumiputera_lot: bool | None = None
    tenure: Tenure = Tenure.UNKNOWN
    lease_expiry: date | None = None
    land_use_category: str | None = None  # Bangunan / Pertanian / Perusahaan
    intended_use: str | None = None  # RESIDENTIAL / AGRICULTURAL / COMMERCIAL
    has_legal_road_access: bool | None = None
    boundary_confirmed: bool | None = None  # boundary stones / survey plan checked
    has_unapproved_renovation: bool | None = None
    quit_rent_assessment_arrears: bool | None = None
    declared_price: Decimal | None = None
    market_value: Decimal | None = None
    payments: list[PaymentIntent] = field(default_factory=list)


@dataclass(frozen=True)
class Flag:
    code: str
    severity: Severity
    title_en: str
    title_ms: str
    message: str
    next_step: str
    message_ms: str = ""
    next_step_ms: str = ""

    def to_dict(self) -> dict[str, str]:
        return self.__dict__.copy()


def _years_remaining(expiry: date, today: date) -> float:
    return (expiry - today).days / 365.25


def evaluate(f: ListingFacts, today: date | None = None) -> list[Flag]:
    today = today or date.today()
    out: list[Flag] = []
    add = out.append

    # 1. Payment safety — cash / personal accounts / no receipts
    for i, p in enumerate(f.payments, start=1):
        if p.method is PaymentMethod.CASH_BY_HAND:
            add(Flag("CASH_BY_HAND", "BLOCK", "Cash hand-over blocked", "Bayaran tunai disekat",
                     f"Payment #{i} (RM{p.amount:,.2f}) is planned as cash by hand. Cash leaves no "
                     "audit trail and is the most common owner-direct fraud pattern.",
                     "Pay only by bank transfer/draft to your lawyer's client account as stakeholder.",
                     f"Bayaran #{i} (RM{p.amount:,.2f}) dirancang secara tunai. Bayaran tunai tiada "
                     "jejak audit dan merupakan punca penipuan paling kerap dalam urus niaga terus.",
                     "Bayar hanya melalui pindahan bank/draf ke akaun pelanggan peguam sebagai pemegang amanah."))
        elif p.method is PaymentMethod.TRANSFER_TO_SELLER_PERSONAL and not (
            p.has_written_receipt and p.has_written_terms
        ):
            add(Flag("UNPROTECTED_PERSONAL_TRANSFER", "BLOCK",
                     "Unprotected transfer to seller", "Pindahan tanpa perlindungan",
                     f"Payment #{i} goes to the seller's personal account without a signed receipt "
                     "and written terms. If the deal collapses you may not recover it.",
                     "Use a signed Letter of Offer with refund terms, or route via lawyer stakeholder.",
                     f"Bayaran #{i} disalurkan ke akaun peribadi penjual tanpa resit dan syarat bertulis. "
                     "Jika urus niaga terbatal, wang anda sukar dituntut semula.",
                     "Gunakan Surat Tawaran rasmi dengan klausa pemulangan, atau salurkan melalui peguam."))
        elif p.method is PaymentMethod.TRANSFER_TO_SELLER_PERSONAL:
            add(Flag("PERSONAL_TRANSFER", "WARN", "Payment direct to seller", "Bayaran terus kepada penjual",
                     f"Payment #{i} goes directly to the seller. Even with a receipt, funds are not "
                     "held as stakeholder.",
                     "Prefer the lawyer's client account; verify account name matches the registered owner.",
                     f"Bayaran #{i} dibuat terus kepada penjual. Walaupun ada resit, wang tidak dipegang pemegang amanah.",
                     "Gunakan akaun peguam; sahkan nama akaun bank sepadan dengan nama pemilik berdaftar."))
        if not p.has_written_receipt and p.method is not PaymentMethod.CASH_BY_HAND:
            add(Flag("NO_RECEIPT", "WARN", "No written receipt", "Tiada resit bertulis",
                     f"Payment #{i} has no written receipt planned.",
                     "Obtain a signed, dated receipt referencing the property title number.",
                     f"Bayaran #{i} tiada perancangan resit bertulis.",
                     "Dapatkan resit bertarikh dan ditandatangani yang menyatakan nombor hakmilik tanah."))

    # 2. Title verification & encumbrances
    if not f.official_title_search_done:
        add(Flag("NO_OFFICIAL_SEARCH", "BLOCK", "Official title search missing", "Carian Rasmi belum dibuat",
                 "Ownership, charges, caveats and restrictions are unverified.",
                 "Order a Carian Rasmi at the Land Office / e-Tanah before paying anything.",
                 "Pemilikan, gadaian, kaveat dan sekatan kepentingan belum disahkan.",
                 "Buat Carian Rasmi di Pejabat Tanah / e-Tanah sebelum membuat sebarang bayaran."))
    elif f.title_search_date and (today - f.title_search_date).days > 30:
        add(Flag("STALE_SEARCH", "WARN", "Title search is older than 30 days", "Carian sudah lama",
                 "Encumbrances may have been registered since.",
                 "Your lawyer should repeat the search immediately before completion.",
                 "Bebanan baharu mungkin telah didaftarkan selepas tarikh carian.",
                 "Peguam anda mesti membuat carian rasmi ulangan sebelum penyelesaian."))
    if f.registered_owner_matches_seller is False:
        add(Flag("OWNER_MISMATCH", "BLOCK", "Seller is not the registered owner", "Penjual bukan pemilik berdaftar",
                 "The person selling does not match the proprietor on title — classic impersonation fraud "
                 "unless backed by a registered Power of Attorney or Letters of Administration.",
                 "Stop. Your lawyer must verify identity, PA registration or estate grant.",
                 "Nama penjual tidak sepadan dengan pemilik pada hakmilik — risiko penyamaran "
                 "melainkan disokong Surat Kuasa Wakil (PA) atau Surat Kuasa Mentadbir.",
                 "Berhenti. Peguam anda mesti mengesahkan identiti, pendaftaran PA atau probet pusaka."))
    if f.has_registrar_caveat:
        add(Flag("REGISTRAR_CAVEAT", "BLOCK", "Registrar's caveat on title", "Kaveat Pendaftar",
                 "Dealings on this land are frozen by the Registrar.", "Do not proceed until it is lifted.",
                 "Urus niaga tanah dibekukan oleh Pendaftar Hakmilik.", "Jangan teruskan sehingga kaveat dibatalkan."))
    if f.has_private_caveat:
        add(Flag("PRIVATE_CAVEAT", "WARN", "Private caveat lodged", "Kaveat persendirian",
                 "A third party claims an interest in this land.",
                 "Require written withdrawal of caveat as a condition precedent in the SPA.",
                 "Pihak ketiga mendaftarkan tuntutan kepentingan ke atas tanah ini.",
                 "Syaratkan penarikan balik kaveat sebagai syarat terdahulu dalam perjanjian jual beli."))
    if f.has_existing_charge:
        add(Flag("EXISTING_CHARGE", "WARN", "Existing bank charge", "Gadaian sedia ada",
                 "The seller's bank must be paid off (redemption) before transfer.",
                 "SPA must provide redemption sum paid directly to the chargee bank by your lawyer/bank.",
                 "Pinjaman bank penjual perlu ditebus sebelum pindah milik.",
                 "Perjanjian mesti menetapkan bayaran penebusan terus kepada bank pemegang gadaian."))
    if f.has_restriction_in_interest:
        add(Flag("RESTRICTION_IN_INTEREST", "WARN", "Restriction in interest", "Sekatan kepentingan",
                 f"Title restriction: '{f.restriction_text[:200]}'. State Authority consent is usually required.",
                 "Budget 1–6 months for consent; make it a condition precedent in the SPA.",
                 f"Sekatan hakmilik: '{f.restriction_text[:200]}'. Kebenaran Pihak Berkuasa Negeri diperlukan.",
                 "Sediakan tempoh 1–6 bulan untuk kelulusan kebenaran negeri."))
    if f.is_malay_reserve and f.buyer_is_malay_as_defined is not True:
        add(Flag("MALAY_RESERVE", "BLOCK", "Malay Reserve land", "Tanah Rizab Melayu",
                 "Only persons qualifying as 'Malay' under the relevant state enactment may hold this land. "
                 "Any nominee/trust arrangement to circumvent this is void.",
                 "Do not proceed unless your lawyer confirms you qualify.",
                 "Hanya individu yang layak sebagai 'Melayu' di bawah enakmen negeri boleh memegang tanah ini. "
                 "Sebarang perjanjian penama atau amanah adalah terbatal.",
                 "Jangan teruskan melainkan peguam mengesahkan kelayakan anda."))
    if f.is_bumiputera_lot:
        add(Flag("BUMI_LOT", "WARN", "Bumiputera lot", "Lot Bumiputera",
                 "Sale to non-Bumiputera buyers may need state release and a release levy.",
                 "Confirm with the state PTG before agreeing price.",
                 "Jualan kepada bukan Bumiputera memerlukan pelepasan negeri dan bayaran levi.",
                 "Sahkan dengan PTG negeri sebelum bersetuju dengan harga."))

    # 3. Tenure
    if f.tenure is Tenure.UNKNOWN:
        add(Flag("TENURE_UNKNOWN", "WARN", "Tenure not confirmed", "Pegangan belum disahkan",
                 "Freehold vs leasehold materially changes value and financing.",
                 "Read tenure from the official search.",
                 "Pegangan kekal berbanding pajakan memberi kesan besar kepada nilai dan pinjaman.",
                 "Sahkan jenis pegangan daripada dokumen Carian Rasmi."))
    elif f.tenure is Tenure.LEASEHOLD:
        if f.lease_expiry is None:
            add(Flag("LEASE_EXPIRY_UNKNOWN", "WARN", "Lease expiry unknown", "Tarikh luput pajakan tidak diketahui",
                     "Remaining lease is unknown.", "Read 'Tempoh Pajakan / Tarikh Luput' on the title.",
                     "Baki tempoh pajakan tidak diketahui.", "Semak tarikh luput pajakan pada hakmilik."))
        else:
            yrs = _years_remaining(f.lease_expiry, today)
            agri = f.property_type in ("AGRICULTURAL_LAND", "VACANT_LAND")
            if yrs < SHORT_LEASE_BLOCK_YEARS or (agri and yrs < SHORT_LEASE_WARN_YEARS):
                add(Flag("SHORT_LEASE", "BLOCK", "Very short remaining lease", "Baki pajakan terlalu pendek",
                         f"About {yrs:.0f} years remain. Banks rarely finance, renewal premium can be high, "
                         "and resale/development value is severely affected.",
                         "Obtain the state's lease-renewal premium quote in writing before any offer.",
                         f"Baki pajakan sekitar {yrs:.0f} tahun. Bank sukar membiayai dan kos lanjutan tinggi.",
                         "Dapatkan sebut harga premium lanjutan pajakan daripada Pejabat Tanah negeri."))
            elif yrs < SHORT_LEASE_WARN_YEARS:
                add(Flag("SHORT_LEASE", "WARN", "Short remaining lease", "Baki pajakan pendek",
                         f"About {yrs:.0f} years remain. Loan tenure and resale value may be limited.",
                         "Ask your bank for its minimum remaining-lease policy.",
                         f"Baki pajakan sekitar {yrs:.0f} tahun. Tempoh pinjaman mungkin terhad.",
                         "Rujuk pihak bank berkenaan polisi baki pajakan minimum."))

    # 4. Access, boundary, land use, renovations
    if f.has_legal_road_access is False:
        add(Flag("NO_LEGAL_ACCESS", "BLOCK", "No legal road access", "Tiada jalan masuk sah",
                 "Land without registered access (road reserve or easement) may be unusable and unfinanceable.",
                 "Confirm access on the certified plan (PA/B1) or require a registered easement.",
                 "Tanah tanpa rezab jalan sah atau hak lalu-lalang mungkin tidak boleh dibina atau dibiayai.",
                 "Sahkan akses pada pelan akui (PA/B1) atau daftarkan hak lalu-lalang."))
    elif f.has_legal_road_access is None:
        add(Flag("ACCESS_UNVERIFIED", "WARN", "Road access unverified", "Akses jalan belum disahkan",
                 "Access has not been checked against the survey plan.", "Check JUPEM certified plan.",
                 "Akses belum disemak terhadap pelan ukur rasmi.", "Semak pelan akui JUPEM."))
    if f.boundary_confirmed is False or (f.boundary_confirmed is None and f.property_type != "RESIDENTIAL_HOUSE"):
        add(Flag("BOUNDARY_UNCONFIRMED", "WARN", "Boundary not confirmed", "Sempadan belum disahkan",
                 "Boundary stones/fences may not match the title area.",
                 "Commission a licensed land surveyor to locate boundary marks.",
                 "Batu sempadan atau pagar mungkin tidak sepadan dengan keluasan hakmilik.",
                 "Lantik jurukur tanah berlesen untuk mengesahkan kedudukan batu sempadan."))
    if f.has_unapproved_renovation:
        add(Flag("UNAPPROVED_RENOVATION", "WARN", "Unapproved renovation/extension", "Ubahsuai tanpa kelulusan",
                 "The local council (PBT) may issue demolition orders or fines against the new owner.",
                 "Request approved building plans and CCC/CF; price in remediation.",
                 "Pihak Berkuasa Tempatan (PBT) boleh mengeluarkan notis roboh atau mengenakan kompaun.",
                 "Minta pelan bangunan yang diluluskan dan CCC/CF."))
    if f.land_use_category and f.intended_use:
        cat = f.land_use_category.strip().lower()
        mapping = {"bangunan": "RESIDENTIAL", "building": "RESIDENTIAL",
                   "pertanian": "AGRICULTURAL", "agriculture": "AGRICULTURAL",
                   "perusahaan": "INDUSTRIAL", "industry": "INDUSTRIAL"}
        if mapping.get(cat) and mapping[cat] != f.intended_use.upper():
            add(Flag("LAND_USE_MISMATCH", "BLOCK", "Land-use category mismatch", "Kategori guna tanah tidak sepadan",
                     f"Title category '{f.land_use_category}' does not permit intended use '{f.intended_use}'.",
                     "Conversion (tukar syarat) needs State approval and premium — get a quote first.",
                     f"Kategori hakmilik '{f.land_use_category}' tidak membenarkan kegunaan '{f.intended_use}'.",
                     "Permohonan tukar syarat memerlukan kelulusan Pihak Berkuasa Negeri dan premium."))
    if f.quit_rent_assessment_arrears:
        add(Flag("ARREARS", "WARN", "Quit rent / assessment arrears", "Tunggakan cukai",
                 "Arrears follow the land.", "SPA must require seller to settle arrears before completion.",
                 "Tunggakan cukai tanah atau cukai pintu terikat kepada hartanah.",
                 "Perjanjian mesti menetapkan penjual menjelaskan semua tunggakan cukai."))

    # 5. Under-declaration
    if f.declared_price is not None and f.market_value is not None and f.market_value > 0:
        if f.declared_price < f.market_value * (1 - UNDER_DECLARATION_TOLERANCE):
            add(Flag("UNDER_DECLARATION_RISK", "BLOCK", "Possible under-declaration", "Risiko pengisytiharan rendah",
                     "Declared price is more than 10% below market value. Under-stating the price on "
                     "Borang 14A to reduce stamp duty is unlawful; duty is assessed on market value and "
                     "both parties face audit and penalties.",
                     "Declare the true consideration. Side payments 'under the table' are not protected by the SPA.",
                     "Harga diisytiharkan melebihi 10% di bawah nilai pasaran. Mengisytiharkan harga rendah "
                     "pada Borang 14A untuk kurangkan duti adalah salah; duti ditaksir atas nilai pasaran.",
                     "Isytiharkan nilai balasan sebenar. Bayaran 'bawah meja' tidak dilindungi perjanjian."))
    return out


def has_blocking(flags: list[Flag]) -> bool:
    return any(fl.severity == "BLOCK" for fl in flags)
