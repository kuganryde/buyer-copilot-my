// Shared types, API client, i18n and money formatting for the Buyer Command Hub.

export type Lang = "en" | "ms";
export type Severity = "BLOCK" | "WARN" | "INFO";
export type GateCode =
  | "HITL_1_LISTING_VETTING" | "HITL_2_OFFER_BUDGET" | "HITL_3_LAWYER_DEPOSIT"
  | "HITL_4_SPA_LOAN_DUTY" | "HITL_5_TRANSFER_HANDOVER";
export type TxnStatus = "PAUSED_FOR_HITL" | "IN_PROGRESS" | "COMPLETED" | "HALTED";
export type DecisionCode = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export const GATES: GateCode[] = [
  "HITL_1_LISTING_VETTING", "HITL_2_OFFER_BUDGET", "HITL_3_LAWYER_DEPOSIT",
  "HITL_4_SPA_LOAN_DUTY", "HITL_5_TRANSFER_HANDOVER",
];

export interface Flag {
  code: string; severity: Severity; title_en?: string; title_ms?: string; message: string; next_step?: string;
}
export interface LineItem {
  key: string; label: string; amount: string; rule_code: string; rule_status: string; payable_at: string; note: string;
}
export interface Cost {
  ruleset_version: string; assessed_value: string; lendable_value: string; valuation_gap: string;
  line_items: LineItem[]; cash_at_signing: string; total_cash_to_completion: string;
  mot_duty_before_relief: string; mot_duty: string; loan_duty: string; exemption_applied: string | null;
  flags: Flag[]; proposed_scenario: Record<string, unknown> | null;
}
export interface Transaction {
  id: string; buyer_id: string; title: string; stage: GateCode; status: TxnStatus; version: number;
  gate_summary: {
    headline?: string; cash_at_signing?: string; total_cash_to_completion?: string; mot_duty?: string;
    loan_duty?: string; exemption_applied?: string | null; next_actions?: string[]; ruleset_version?: string;
  };
  flags: Flag[]; gate_description: Record<Lang, string>; gate_index: number; gate_total: number;
  created_at: string; updated_at: string;
}
export interface Approval {
  id: string; seq: number; gate: GateCode; decision: DecisionCode; actor_id: string; comment: string;
  acknowledged_flags: string[]; created_at: string; prev_hash: string; row_hash: string;
}
export interface DirectoryEntry {
  id?: string; agency_name: string; category: string; jurisdiction_state: string; official_url: string;
  contact_details: string; summary_rule: string; last_verified_date: string | null;
  is_proposed_pending_gazette: boolean; freshness_status: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** All calls go to our own origin; the server route adds credentials. */
export async function api<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/copilot/${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string; detail?: unknown };
    const detail = typeof d.detail === "string" ? d.detail : Array.isArray(d.detail) ? "Some fields are invalid." : "";
    throw new ApiError(res.status, d.error ?? `http_${res.status}`, d.message ?? detail ?? `Request failed (${res.status})`);
  }
  return data as T;
}

/** Format a decimal STRING as RM without ever converting to float (no rounding drift). */
export function rm(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const neg = value.startsWith("-");
  const [intPart = "0", frac = ""] = value.replace("-", "").split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}RM ${grouped}.${(frac + "00").slice(0, 2)}`;
}

/** Accept only plain decimal input, return a canonical string the engine accepts. */
export function cleanMoney(input: string): string | null {
  const s = input.replace(/[,\s]/g, "").replace(/^RM/i, "");
  return /^\d{1,10}(\.\d{1,2})?$/.test(s) ? s : null;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export const GATE_LABEL: Record<GateCode, Record<Lang, string>> = {
  HITL_1_LISTING_VETTING: { en: "1 · Listing vetting", ms: "1 · Semakan iklan" },
  HITL_2_OFFER_BUDGET: { en: "2 · Offer & budget", ms: "2 · Tawaran & bajet" },
  HITL_3_LAWYER_DEPOSIT: { en: "3 · Lawyer & deposit", ms: "3 · Peguam & deposit" },
  HITL_4_SPA_LOAN_DUTY: { en: "4 · SPA, loan & duty", ms: "4 · Perjanjian, pinjaman & duti" },
  HITL_5_TRANSFER_HANDOVER: { en: "5 · Transfer & handover", ms: "5 · Pindah milik & serahan" },
};

export const DOCS_BY_GATE: Record<GateCode, { key: string; en: string; ms: string }[]> = {
  HITL_1_LISTING_VETTING: [
    { key: "listing", en: "Listing / advert screenshots", ms: "Tangkapan iklan" },
    { key: "seller_ic", en: "Seller IC copy (verify against title)", ms: "Salinan IC penjual" },
    { key: "title_copy", en: "Copy of title (geran) from seller", ms: "Salinan geran daripada penjual" },
    { key: "site_photos", en: "Site visit photos: boundary, access, renovations", ms: "Gambar lawatan tapak" },
  ],
  HITL_2_OFFER_BUDGET: [
    { key: "official_search", en: "Official Title Search (Carian Rasmi)", ms: "Carian Rasmi" },
    { key: "valuation", en: "Valuation report", ms: "Laporan penilaian" },
    { key: "loan_offer", en: "Bank loan offer / pre-approval", ms: "Surat tawaran pinjaman" },
    { key: "survey_plan", en: "Certified survey plan (land)", ms: "Pelan akui (tanah)" },
  ],
  HITL_3_LAWYER_DEPOSIT: [
    { key: "lawyer_letter", en: "Lawyer engagement letter & fee quote", ms: "Surat lantikan peguam & sebut harga" },
    { key: "offer_letter", en: "Signed letter of offer with refund terms", ms: "Surat tawaran bertandatangan" },
    { key: "deposit_receipt", en: "Deposit receipt from lawyer's client account", ms: "Resit deposit akaun klien peguam" },
  ],
  HITL_4_SPA_LOAN_DUTY: [
    { key: "spa", en: "Sale & Purchase Agreement (SPA)", ms: "Perjanjian Jual Beli" },
    { key: "loan_agreement", en: "Loan / facility agreement", ms: "Perjanjian pinjaman" },
    { key: "redemption", en: "Seller's redemption statement", ms: "Penyata penebusan penjual" },
    { key: "consent", en: "State consent (if restricted title)", ms: "Kebenaran negeri" },
    { key: "stamp_cert", en: "Stamp duty certificates (STAMPS)", ms: "Sijil duti setem" },
  ],
  HITL_5_TRANSFER_HANDOVER: [
    { key: "mot", en: "Registered MOT (Borang 14A)", ms: "Borang 14A berdaftar" },
    { key: "new_title", en: "Title in your name (fresh search)", ms: "Hakmilik atas nama anda" },
    { key: "vp_checklist", en: "Vacant possession checklist & keys", ms: "Senarai semak milikan kosong & kunci" },
    { key: "utilities", en: "Utility transfers & final bills", ms: "Pindahan utiliti & bil akhir" },
    { key: "apportionment", en: "Quit rent / assessment apportionment", ms: "Pembahagian cukai tanah / taksiran" },
  ],
};

export const T = {
  en: {
    appTitle: "Buyer Co-Pilot", appSub: "Buying land or a house in Malaysia directly from the owner",
    disclaimerLead: "Not legal, tax or valuation advice.",
    disclaimer: "This tool explains, calculates and flags risks — it never transfers money, signs documents or files with any authority. Confirm every step with a licensed conveyancing lawyer.",
    navConsole: "Approvals", navCalc: "Cash & duty", navVault: "Documents", navDir: "Directory",
    consoleTitle: "Stage & approval console",
    consoleSub: "Nothing moves forward until you approve. Blocking risks must be fixed first; warnings must be acknowledged.",
    noTxn: "No transaction open yet.", newTxn: "Start a transaction", txnTitle: "Property nickname",
    openTxn: "Open by ID", load: "Open",
    pending: "Waiting for your decision", inProgress: "Co-pilot is preparing the next review",
    completed: "Transaction completed and archived", halted: "Transaction halted (rejected)",
    approve: "Approve", requestChanges: "Request changes", reject: "Reject & stop",
    comment: "Comment", commentHint: "Required for changes or rejection",
    ack: "I have read and accept this warning", confirmReject: "Rejecting halts this transaction permanently. Continue?",
    blocking: "Approval is disabled until blocking risks are resolved.",
    history: "Decision history", chainOk: "Audit chain intact", chainBad: "AUDIT CHAIN BROKEN",
    calcTitle: "Upfront cash & stamp duty", calcSub: "Exact figures from the rule engine. Statutory rates are shown with their legal status.",
    price: "Purchase price (RM)", mv: "Valuation / market value (RM)", mvHint: "Leave blank if not valued yet",
    loan: "Loan amount (RM)", ptype: "Property type", house: "House", vacant: "Vacant land", agri: "Agricultural land",
    buyer: "Buyer status", citizen: "Malaysian citizen", pr: "Permanent resident", nonCitizen: "Non-citizen",
    spaDate: "Expected SPA date", ftb: "First-time homebuyer", never: "Never owned residential property (incl. inherited, gifted, joint)",
    consent: "Title needs State consent", survey: "Include boundary re-survey",
    b2027: "Show Budget 2027 proposal (pending gazette)", calculate: "Calculate",
    atSigning: "Cash needed at signing", total: "Total cash to completion", duty: "MOT stamp duty",
    proposedTitle: "Budget 2027 proposal — NOT LAW YET",
    vaultTitle: "Document vault & checklist", vaultSub: "Track evidence per stage. Files are fingerprinted (SHA-256) in your browser; upload to encrypted storage is wired by your deployment.",
    pasteSearch: "Paste official title search text to interpret", interpret: "Interpret",
    verifyFacts: "Machine-read facts — check each against the original document.",
    dirTitle: "Legal, statutory & process directory", dirSub: "Official sources. Every entry shows when a person last verified it.",
    allCats: "All categories", allStates: "All states", lastVerified: "Last verified", notVerified: "Not yet verified",
    engineDown: "The rule engine is unavailable. No figures are shown rather than guessed.",
    footer: "Ruleset",
  },
  ms: {
    appTitle: "Pembantu Pembeli", appSub: "Membeli tanah atau rumah di Malaysia terus daripada pemilik",
    disclaimerLead: "Bukan nasihat undang-undang, cukai atau penilaian.",
    disclaimer: "Alat ini menerangkan, mengira dan menandakan risiko — ia tidak memindahkan wang, menandatangani dokumen atau memfailkan dengan mana-mana pihak berkuasa. Sahkan setiap langkah dengan peguam hartanah berlesen.",
    navConsole: "Kelulusan", navCalc: "Tunai & duti", navVault: "Dokumen", navDir: "Direktori",
    consoleTitle: "Konsol peringkat & kelulusan",
    consoleSub: "Tiada langkah diteruskan tanpa kelulusan anda. Risiko menyekat mesti diselesaikan; amaran mesti diakui.",
    noTxn: "Tiada transaksi dibuka.", newTxn: "Mula transaksi", txnTitle: "Nama ringkas hartanah",
    openTxn: "Buka melalui ID", load: "Buka",
    pending: "Menunggu keputusan anda", inProgress: "Pembantu sedang menyediakan semakan seterusnya",
    completed: "Transaksi selesai dan diarkibkan", halted: "Transaksi dihentikan (ditolak)",
    approve: "Luluskan", requestChanges: "Minta perubahan", reject: "Tolak & henti",
    comment: "Ulasan", commentHint: "Wajib untuk perubahan atau penolakan",
    ack: "Saya telah membaca dan menerima amaran ini", confirmReject: "Penolakan akan menghentikan transaksi ini secara kekal. Teruskan?",
    blocking: "Kelulusan dinyahaktifkan sehingga risiko menyekat diselesaikan.",
    history: "Sejarah keputusan", chainOk: "Rantaian audit utuh", chainBad: "RANTAIAN AUDIT ROSAK",
    calcTitle: "Wang pendahuluan & duti setem", calcSub: "Angka tepat daripada enjin peraturan. Kadar berkanun dipaparkan bersama status undang-undangnya.",
    price: "Harga belian (RM)", mv: "Nilai pasaran / penilaian (RM)", mvHint: "Biarkan kosong jika belum dinilai",
    loan: "Jumlah pinjaman (RM)", ptype: "Jenis hartanah", house: "Rumah", vacant: "Tanah kosong", agri: "Tanah pertanian",
    buyer: "Status pembeli", citizen: "Warganegara Malaysia", pr: "Penduduk tetap", nonCitizen: "Bukan warganegara",
    spaDate: "Jangkaan tarikh perjanjian", ftb: "Pembeli rumah pertama", never: "Tidak pernah memiliki rumah kediaman (termasuk warisan, hadiah, bersama)",
    consent: "Hakmilik perlu kebenaran Negeri", survey: "Termasuk ukur semula sempadan",
    b2027: "Papar cadangan Bajet 2027 (belum diwartakan)", calculate: "Kira",
    atSigning: "Tunai semasa menandatangani", total: "Jumlah tunai hingga selesai", duty: "Duti setem MOT",
    proposedTitle: "Cadangan Bajet 2027 — BELUM MENJADI UNDANG-UNDANG",
    vaultTitle: "Peti dokumen & senarai semak", vaultSub: "Jejaki bukti setiap peringkat. Fail dicap jari (SHA-256) dalam pelayar anda.",
    pasteSearch: "Tampal teks carian rasmi untuk ditafsir", interpret: "Tafsir",
    verifyFacts: "Fakta dibaca mesin — semak setiap satu dengan dokumen asal.",
    dirTitle: "Direktori undang-undang, berkanun & proses", dirSub: "Sumber rasmi. Setiap entri memaparkan bila ia terakhir disahkan oleh manusia.",
    allCats: "Semua kategori", allStates: "Semua negeri", lastVerified: "Terakhir disahkan", notVerified: "Belum disahkan",
    engineDown: "Enjin peraturan tidak tersedia. Tiada angka dipaparkan dan bukannya diteka.",
    footer: "Set peraturan",
  },
} as const;

export type Dict = { [K in keyof (typeof T)["en"]]: string };
