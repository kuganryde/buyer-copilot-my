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
    // Keep the machine code; user-facing wording comes from errorCopy() so it is bilingual and actionable.
    const code = d.error ?? (Array.isArray(d.detail) ? "VALIDATION" : `http_${res.status}`);
    throw new ApiError(res.status, code, d.message ?? (typeof d.detail === "string" ? d.detail : ""));
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

/* =============================================================================
 * Content layer. Voice: calm, plain, protective — like a careful friend who knows
 * property law, not a salesperson or a lawyer. See CONTENT_GUIDE.md.
 * Rules: sentence-case buttons ([verb] [object]); title-case page/section titles,
 * nav items and field labels; errors = what happened + why + what to do;
 * never show raw system codes; define jargon on first use; spell out months.
 * ===========================================================================*/

type Bi = Record<Lang, string>;

/** Short step names for the progress tracker (sentence case, ≤4 words). */
export const GATE_LABEL: Record<GateCode, Bi> = {
  HITL_1_LISTING_VETTING: { en: "Check the listing", ms: "Semak iklan" },
  HITL_2_OFFER_BUDGET: { en: "Set offer and budget", ms: "Tetapkan tawaran dan bajet" },
  HITL_3_LAWYER_DEPOSIT: { en: "Lawyer and deposit", ms: "Peguam dan deposit" },
  HITL_4_SPA_LOAN_DUTY: { en: "Sign and pay duty", ms: "Tandatangan dan bayar duti" },
  HITL_5_TRANSFER_HANDOVER: { en: "Transfer and keys", ms: "Pindah milik dan kunci" },
};

/** What the buyer is deciding at each step — owned by the UI, not the engine. */
export const GATE_INTRO: Record<GateCode, Bi> = {
  HITL_1_LISTING_VETTING: {
    en: "Review the listing, title facts and risks. Approve to order an official title search and site checks.",
    ms: "Semak iklan, fakta hakmilik dan risiko. Luluskan untuk membuat carian rasmi hakmilik dan semakan tapak.",
  },
  HITL_2_OFFER_BUDGET: {
    en: "Review the title search, site visit and valuation. Approve your offer price, loan amount and cash buffer.",
    ms: "Semak carian hakmilik, lawatan tapak dan penilaian. Luluskan harga tawaran, jumlah pinjaman dan simpanan tunai anda.",
  },
  HITL_3_LAWYER_DEPOSIT: {
    en: "Choose your lawyer and agree the deposit terms. Your deposit goes to the lawyer's client account, with a written receipt.",
    ms: "Pilih peguam dan setuju terma deposit. Deposit dibayar ke akaun klien peguam, dengan resit bertulis.",
  },
  HITL_4_SPA_LOAN_DUTY: {
    en: "Go through the sale agreement (SPA), loan, State consent and stamp duty with your lawyer. Approve before you sign or release money.",
    ms: "Teliti Perjanjian Jual Beli (SPA), pinjaman, kebenaran Negeri dan duti setem bersama peguam. Luluskan sebelum menandatangani atau melepaskan wang.",
  },
  HITL_5_TRANSFER_HANDOVER: {
    en: "Confirm the transfer is registered in your name and you have the keys, utilities and final bills. Approve to close the file.",
    ms: "Sahkan pindah milik telah didaftarkan atas nama anda dan anda telah menerima kunci, akaun utiliti dan bil akhir. Luluskan untuk menutup fail.",
  },
};

export const SEVERITY_LABEL: Record<Severity, Bi> = {
  BLOCK: { en: "Must fix", ms: "Mesti dibaiki" },
  WARN: { en: "Warning", ms: "Amaran" },
  INFO: { en: "Good to know", ms: "Untuk makluman" },
};

export const STATUS_LABEL: Record<TxnStatus, Bi> = {
  PAUSED_FOR_HITL: { en: "Needs your review", ms: "Perlu semakan anda" },
  IN_PROGRESS: { en: "In progress", ms: "Sedang diproses" },
  COMPLETED: { en: "Complete", ms: "Selesai" },
  HALTED: { en: "Stopped", ms: "Dihentikan" },
};

export const DECISION_LABEL: Record<DecisionCode, Bi> = {
  APPROVED: { en: "Approved", ms: "Diluluskan" },
  CHANGES_REQUESTED: { en: "Changes requested", ms: "Minta perubahan" },
  REJECTED: { en: "Rejected", ms: "Ditolak" },
};

/** When a cost is paid. "INFO" items are not extra cash. */
export const PAYABLE_LABEL: Record<string, Bi> = {
  SIGNING: { en: "At signing", ms: "Semasa tandatangan" },
  COMPLETION: { en: "At completion", ms: "Semasa selesai" },
  INFO: { en: "Not extra", ms: "Bukan tambahan" },
};

/** How firm a figure is. */
export const BASIS_LABEL: Record<string, Bi & { hint_en: string; hint_ms: string }> = {
  GAZETTED: { en: "Set by law", ms: "Ditetapkan undang-undang", hint_en: "Rate is fixed by gazetted law.", hint_ms: "Kadar ditetapkan oleh undang-undang yang diwartakan." },
  ESTIMATE: { en: "Estimate", ms: "Anggaran", hint_en: "Typical amount. Replace with your lawyer's written quote.", hint_ms: "Jumlah biasa. Gantikan dengan sebut harga bertulis peguam anda." },
  PROPOSED_PENDING_GAZETTE: { en: "Proposal", ms: "Cadangan", hint_en: "Announced but not yet law.", hint_ms: "Diumumkan tetapi belum menjadi undang-undang." },
};

/** Bilingual names for engine line items (engine labels are English-only). */
export const LINE_LABEL: Record<string, Bi> = {
  deposit: { en: "Deposit, held by your lawyer", ms: "Deposit, dipegang oleh peguam anda" },
  official_title_search: { en: "Official title search (Carian Rasmi)", ms: "Carian Rasmi hakmilik" },
  bankruptcy_winding_up_search: { en: "Bankruptcy check on the seller", ms: "Semakan kebankrapan penjual" },
  valuation_fee: { en: "Valuation report", ms: "Laporan penilaian" },
  spa_legal_fee: { en: "Lawyer's fee for the sale agreement", ms: "Yuran guaman perjanjian jual beli" },
  loan_legal_fee: { en: "Lawyer's fee for the loan", ms: "Yuran guaman pinjaman" },
  sst_legal: { en: "8% SST on lawyer's fees", ms: "SST 8% atas yuran guaman" },
  mot_duty: { en: "Stamp duty on the transfer (MOT)", ms: "Duti setem pindah milik (MOT)" },
  loan_duty: { en: "Stamp duty on the loan agreement", ms: "Duti setem perjanjian pinjaman" },
  land_office_registration: { en: "Land office registration", ms: "Pendaftaran pejabat tanah" },
  disbursements_misc: { en: "Other lawyer's expenses", ms: "Perbelanjaan lain peguam" },
  balance_cash: { en: "Rest of the price you pay in cash", ms: "Baki harga yang dibayar tunai" },
  state_consent_fee: { en: "State consent fee", ms: "Fi kebenaran Negeri" },
  survey_fee_optional: { en: "Boundary survey", ms: "Ukur sempadan" },
  rpgt_retention: { en: "3% held back for LHDN (RPGT)", ms: "3% ditahan untuk LHDN (RPGT)" },
};
export const LINE_NOTE: Record<string, Bi> = {
  deposit: { en: "Pay only into the lawyer's client account. Never in cash or to a personal account.", ms: "Bayar hanya ke akaun klien peguam. Jangan bayar tunai atau ke akaun peribadi." },
  rpgt_retention: { en: "Comes out of the price, so it isn't extra cash. Your lawyer pays it to LHDN.", ms: "Diambil daripada harga, jadi bukan tunai tambahan. Peguam anda membayarnya kepada LHDN." },
};

/** Plain names for machine-read title search fields. */
export const FACT_LABEL: Record<string, Bi> = {
  title_no: { en: "Title number", ms: "No. hakmilik" },
  lot_no: { en: "Lot number", ms: "No. lot" },
  proprietor: { en: "Registered owner", ms: "Pemilik berdaftar" },
  tenure: { en: "Tenure", ms: "Pegangan" },
  lease_expiry: { en: "Lease ends", ms: "Pajakan tamat" },
  lease_years: { en: "Lease length (years)", ms: "Tempoh pajakan (tahun)" },
  land_use_category: { en: "Land use", ms: "Kategori kegunaan tanah" },
  has_existing_charge: { en: "Bank loan on the land (Gadaian)", ms: "Gadaian bank" },
  has_private_caveat: { en: "Private caveat", ms: "Kaveat persendirian" },
  has_registrar_caveat: { en: "Registrar's caveat", ms: "Kaveat pendaftar" },
  has_restriction_in_interest: { en: "Restriction in interest", ms: "Sekatan kepentingan" },
  restriction_text: { en: "Restriction wording", ms: "Teks sekatan" },
  is_malay_reserve: { en: "Malay Reserve land", ms: "Tanah Rizab Melayu" },
};
export const TENURE_LABEL: Record<string, Bi> = {
  FREEHOLD: { en: "Freehold", ms: "Kekal" },
  LEASEHOLD: { en: "Leasehold", ms: "Pajakan" },
  UNKNOWN: { en: "Not found", ms: "Tidak dijumpai" },
};

export const FRESHNESS_LABEL: Record<string, Bi> = {
  VERIFIED: { en: "Checked", ms: "Disahkan" },
  STALE: { en: "Needs recheck", ms: "Perlu disemak semula" },
  UNVERIFIED: { en: "Not checked yet", ms: "Belum disahkan" },
  PROPOSED_PENDING_GAZETTE: { en: "Proposal", ms: "Cadangan" },
  INACTIVE: { en: "Retired", ms: "Tidak aktif" },
};

export const CATEGORY_LABEL: Record<string, Bi> = {
  STAMP_DUTY_TAX: { en: "Stamp duty and tax", ms: "Duti setem dan cukai" },
  LAND_OFFICE: { en: "Land office", ms: "Pejabat tanah" },
  VALUATION: { en: "Valuation", ms: "Penilaian" },
  LEGAL_PROFESSIONAL: { en: "Lawyers and fees", ms: "Peguam dan yuran" },
  FINANCING: { en: "Loans and banks", ms: "Pinjaman dan bank" },
  SURVEY_PLANNING: { en: "Survey and planning", ms: "Ukur dan perancangan" },
  LOCAL_COUNCIL_UTILITIES: { en: "Council and utilities", ms: "Majlis dan utiliti" },
  LEGISLATION: { en: "Laws", ms: "Undang-undang" },
};

export const STATE_LABEL: Record<string, string> = {
  NATIONAL: "Nationwide", JOHOR: "Johor", KEDAH: "Kedah", KELANTAN: "Kelantan", MELAKA: "Melaka",
  NEGERI_SEMBILAN: "Negeri Sembilan", PAHANG: "Pahang", PENANG: "Pulau Pinang", PERAK: "Perak", PERLIS: "Perlis",
  SABAH: "Sabah", SARAWAK: "Sarawak", SELANGOR: "Selangor", TERENGGANU: "Terengganu",
  WP_KUALA_LUMPUR: "Kuala Lumpur", WP_LABUAN: "Labuan", WP_PUTRAJAYA: "Putrajaya",
};

export const DOCS_BY_GATE: Record<GateCode, { key: string; en: string; ms: string }[]> = {
  HITL_1_LISTING_VETTING: [
    { key: "listing", en: "Listing or advert screenshots", ms: "Tangkapan skrin iklan" },
    { key: "seller_ic", en: "Seller's IC, to match against the title", ms: "IC penjual, untuk dipadankan dengan hakmilik" },
    { key: "title_copy", en: "Copy of the title (geran) from the seller", ms: "Salinan geran daripada penjual" },
    { key: "site_photos", en: "Site photos: boundary, road access, renovations", ms: "Gambar tapak: sempadan, jalan masuk, ubah suai" },
  ],
  HITL_2_OFFER_BUDGET: [
    { key: "official_search", en: "Official title search (Carian Rasmi)", ms: "Carian Rasmi hakmilik" },
    { key: "valuation", en: "Valuation report", ms: "Laporan penilaian" },
    { key: "loan_offer", en: "Bank loan offer or pre-approval", ms: "Surat tawaran atau prakelulusan pinjaman" },
    { key: "survey_plan", en: "Certified survey plan (for land)", ms: "Pelan akui (untuk tanah)" },
  ],
  HITL_3_LAWYER_DEPOSIT: [
    { key: "lawyer_letter", en: "Lawyer's engagement letter and fee quote", ms: "Surat lantikan dan sebut harga peguam" },
    { key: "offer_letter", en: "Signed offer letter with refund terms", ms: "Surat tawaran bertandatangan dengan terma bayaran balik" },
    { key: "deposit_receipt", en: "Deposit receipt from the lawyer's client account", ms: "Resit deposit daripada akaun klien peguam" },
  ],
  HITL_4_SPA_LOAN_DUTY: [
    { key: "spa", en: "Sale and Purchase Agreement (SPA)", ms: "Perjanjian Jual Beli (SPA)" },
    { key: "loan_agreement", en: "Loan agreement", ms: "Perjanjian pinjaman" },
    { key: "redemption", en: "Seller's loan redemption statement", ms: "Penyata penebusan pinjaman penjual" },
    { key: "consent", en: "State consent letter (if the title needs it)", ms: "Surat kebenaran Negeri (jika perlu)" },
    { key: "stamp_cert", en: "Stamp duty certificates", ms: "Sijil duti setem" },
  ],
  HITL_5_TRANSFER_HANDOVER: [
    { key: "mot", en: "Registered transfer form (Borang 14A)", ms: "Borang 14A yang didaftarkan" },
    { key: "new_title", en: "Fresh title search showing your name", ms: "Carian hakmilik baharu atas nama anda" },
    { key: "vp_checklist", en: "Handover checklist and keys", ms: "Senarai semak serahan dan kunci" },
    { key: "utilities", en: "Utility transfers and final bills", ms: "Pindahan utiliti dan bil akhir" },
    { key: "apportionment", en: "Quit rent and assessment split with seller", ms: "Pembahagian cukai tanah dan taksiran dengan penjual" },
  ],
};

export const T = {
  en: {
    appTitle: "Buyer Co-Pilot",
    appSub: "Buy land or a house directly from the owner, safely",
    langGroup: "Language", langEn: "English", langMs: "Bahasa Melayu",
    disclaimerLead: "General guidance, not legal advice.",
    disclaimer: "We explain costs and flag risks. We never move money, sign documents or file anything for you. Check every step with your lawyer.",

    navConsole: "Approvals", navCalc: "Costs", navVault: "Documents", navDir: "Official Sources",

    consoleTitle: "Your Approvals",
    consoleSub: "Your purchase moves forward only when you approve. Fix risks marked “Must fix” first, and tick each warning to confirm you've read it.",
    stepsLabel: "Purchase steps",
    stepDone: "done", stepCurrent: "current step", stepTodo: "not started", stepStopped: "stopped",
    newTxnHeading: "Start a purchase",
    newTxnBody: "Give the property a name so you can find it later. Only you see it.",
    txnTitle: "Property Name", txnTitlePh: "Teres 2 tingkat, Kajang",
    newTxn: "Start purchase",
    openTxnHeading: "Continue a purchase",
    openTxnBody: "Paste the transaction ID from your earlier session.",
    txnId: "Transaction ID", openTxn: "Open purchase",
    txnIdInvalid: "Transaction ID must be 36 characters, like 0160f6e9-33cd-4b1a-855d-5393383d757c",
    idLabel: "ID", versionLabel: "version",
    stepOf: "Step {n} of {total}",
    keyFigures: "Key figures",
    nextActions: "After you approve",
    risksHeading: "Risks to review",
    ack: "I've read this warning and accept the risk",
    reasonBlocked1: "You can approve once the must-fix risk is resolved. To walk away, stop the purchase.",
    reasonBlockedN: "You can approve once all {n} must-fix risks are resolved. To walk away, stop the purchase.",
    reasonWarn1: "Tick the warning above to approve.",
    reasonWarnN: "Tick all {n} warnings above to approve.",
    comment: "Note for Your Records", commentHint: "Required to request changes or reject. Say what should change and why.",
    commentPh: "Lease expiry looks wrong — please recheck the title search.",
    commentRequired: "Add a short note (5+ characters) explaining your decision.",
    approve: "Approve this step", requestChanges: "Request changes", reject: "Stop this purchase",
    confirmRejectTitle: "Stop this purchase?",
    confirmRejectBody: "This closes the transaction for good. You can't reopen it, but your records stay saved.",
    confirmRejectYes: "Yes, stop purchase", confirmRejectNo: "Keep reviewing",
    refresh: "Check for updates", switchTxn: "Switch purchase",
    statusInProgress: "We're preparing your next review. Nothing moves forward without your approval.",
    statusCompleted: "Purchase complete. Your full decision history is saved below.",
    statusHalted: "You stopped this purchase. Your decision history is saved below.",
    okCreated: "Purchase started. We'll ask for your review once the listing check is ready.",
    okApproved: "Step approved. We're preparing your next review.",
    okApprovedFinal: "Final step approved. Your purchase is complete.",
    okChanges: "Changes requested. This step will come back to you once it's updated.",
    okRejected: "Purchase stopped. This transaction is now closed.",
    historyTitle: "Decision history",
    historyEmpty: "No decisions yet. Each approval you make will appear here.",
    chainOk: "Record intact", chainBad: "Record altered",
    chainOkHint: "Every decision is sealed with a check code. Any change to past decisions would show here.",
    chainBadHint: "A past decision doesn't match its check code. Don't proceed — contact support.",
    colStep: "Step", colDecision: "Decision", colWhen: "Date", colCode: "Check code",

    calcTitle: "Cash and Stamp Duty",
    calcSub: "See how much cash you need and when. Figures come from Malaysian rates, each marked by how firm it is.",
    price: "Purchase Price (RM)", mv: "Valuation (RM)", mvHint: "Leave blank if the property isn't valued yet.",
    loan: "Loan Amount (RM)", ptype: "Property Type", house: "House", vacant: "Vacant land", agri: "Agricultural land",
    buyer: "You Are a", citizen: "Malaysian citizen", pr: "Permanent resident", nonCitizen: "Non-citizen",
    spaDate: "Expected Signing Date", spaHint: "The date you expect to sign the SPA (sale agreement).",
    moneyInvalid: "Enter an amount in ringgit, like 450000 or 450000.50",
    eligibility: "About you and the property",
    ftb: "This is my first home",
    never: "I've never owned a home — including through inheritance, a gift or joint ownership",
    consent: "The title needs State consent to transfer",
    survey: "Add a boundary survey",
    b2027: "Also show the Budget 2027 proposal (not law yet)",
    calculate: "Calculate costs", calculating: "Calculating…",
    calcEmpty: "Enter the price and loan, then calculate to see the cash you'll need.",
    atSigning: "Cash at signing", total: "Total cash needed", duty: "Stamp duty on transfer",
    exemptOk: "First-home exemption applies. Transfer stamp duty drops from {from} to {to}.",
    gapWarn: "The valuation is {gap} below the price. Banks lend on the lower figure, so plan to pay this gap in cash.",
    colItem: "Cost", colWhenPay: "When", colBasis: "How firm", colAmount: "Amount",
    proposedBadge: "Not law yet",
    proposedTitle: "Budget 2027 proposal",
    proposedBody: "If this becomes law, transfer duty would be {mot} and loan duty {loan}. You'd save {save}.",
    proposedNA: "This proposal wouldn't apply to your purchase.",
    proposedCaution: "Don't budget on this until your lawyer confirms it's law.",
    rulesetNote: "Rates from ruleset {v}",

    vaultTitle: "Documents",
    vaultSub: "Track what you have for each step. Adding a file creates a fingerprint in your browser so you can later prove it hasn't changed. Files aren't uploaded.",
    vaultStep: "Show documents for",
    vaultCount: "{n} of {total} ready",
    addFile: "Add file", fileFor: "Add file for {doc}",
    fileTypeErr: "That file type isn't supported. Choose a PDF, JPG, PNG or text file.",
    fileSizeErr: "That file is too large. Choose a file under 25 MB.",
    fingerprint: "Fingerprint",
    readTitle: "Read a Title Search",
    readTitleBody: "Paste the text from your official title search. We'll pull out the key facts so you can check them.",
    pasteLabel: "Title Search Text",
    readBtn: "Read title search",
    verifyFacts: "Read by computer. Check each fact against the original document before relying on it.",
    found: "Found", notFound: "Not found",

    dirTitle: "Official Sources",
    dirSub: "Government agencies and rules that apply to your purchase. Each shows when someone last checked it.",
    allCats: "All topics", allStates: "All states", filterCat: "Topic", filterState: "State",
    lastVerified: "Last checked", notVerified: "Not checked yet",
    dirEmpty: "No sources match these filters. Try “All topics” or “All states”.",
    visitSite: "Visit {host}", opensNewTab: "(opens in new tab)",
    footer: "Built to help you buy safely. Your lawyer has the final word.",

    // Errors: what happened. why. what to do.
    errSignedOut: "You're signed out. Sign in again to continue.",
    errBlocked: "Request blocked for your safety. Reload the page and try again.",
    errEngine: "Can't reach the cost engine right now. We won't guess your figures. Try again in a minute.",
    errRate: "Too many requests. Wait a minute, then try again.",
    errTooLarge: "That text is too long. Paste only the title search pages.",
    errNotFound: "Purchase not found. Check the transaction ID, or start a new purchase.",
    errStale: "This step changed while you were reviewing it. We've loaded the latest version — check it, then decide again.",
    errBlocking: "Can't approve yet. Resolve the must-fix risks first, or stop the purchase.",
    errUnacked: "Tick each warning to confirm you've read it, then approve.",
    errComment: "Add a short note explaining what should change.",
    errNotPaused: "This step isn't waiting for a decision any more. Check for updates to see where it stands.",
    errInvalid: "Check your figures. {msg}",
    errValidation: "Some details aren't valid. Check the highlighted fields and try again.",
    errGeneric: "That didn't go through. Try again in a moment.",
  },
  ms: {
    appTitle: "Pembantu Pembeli",
    appSub: "Beli tanah atau rumah terus daripada pemilik, dengan selamat",
    langGroup: "Bahasa", langEn: "English", langMs: "Bahasa Melayu",
    disclaimerLead: "Panduan umum, bukan nasihat undang-undang.",
    disclaimer: "Kami menerangkan kos dan menandakan risiko. Kami tidak memindahkan wang, menandatangani dokumen atau memfailkan apa-apa bagi pihak anda. Sahkan setiap langkah dengan peguam anda.",

    navConsole: "Kelulusan", navCalc: "Kos", navVault: "Dokumen", navDir: "Sumber Rasmi",

    consoleTitle: "Kelulusan Anda",
    consoleSub: "Pembelian anda hanya diteruskan apabila anda meluluskannya. Selesaikan risiko bertanda “Mesti dibaiki” dahulu, dan tandakan setiap amaran untuk mengesahkan anda telah membacanya.",
    stepsLabel: "Langkah pembelian",
    stepDone: "selesai", stepCurrent: "langkah semasa", stepTodo: "belum bermula", stepStopped: "dihentikan",
    newTxnHeading: "Mula pembelian",
    newTxnBody: "Beri nama kepada hartanah supaya mudah dicari kemudian. Hanya anda yang melihatnya.",
    txnTitle: "Nama Hartanah", txnTitlePh: "Teres 2 tingkat, Kajang",
    newTxn: "Mula pembelian",
    openTxnHeading: "Sambung pembelian",
    openTxnBody: "Tampal ID transaksi daripada sesi anda sebelum ini.",
    txnId: "ID Transaksi", openTxn: "Buka pembelian",
    txnIdInvalid: "ID transaksi mesti 36 aksara, contohnya 0160f6e9-33cd-4b1a-855d-5393383d757c",
    idLabel: "ID", versionLabel: "versi",
    stepOf: "Langkah {n} daripada {total}",
    keyFigures: "Angka utama",
    nextActions: "Selepas anda meluluskan",
    risksHeading: "Risiko untuk disemak",
    ack: "Saya telah membaca amaran ini dan menerima risikonya",
    reasonBlocked1: "Anda boleh meluluskan setelah risiko mesti-dibaiki diselesaikan. Untuk menarik diri, hentikan pembelian.",
    reasonBlockedN: "Anda boleh meluluskan setelah kesemua {n} risiko mesti-dibaiki diselesaikan. Untuk menarik diri, hentikan pembelian.",
    reasonWarn1: "Tandakan amaran di atas untuk meluluskan.",
    reasonWarnN: "Tandakan kesemua {n} amaran di atas untuk meluluskan.",
    comment: "Catatan untuk Rekod Anda", commentHint: "Wajib untuk minta perubahan atau menolak. Nyatakan apa yang perlu diubah dan sebabnya.",
    commentPh: "Tarikh luput pajakan nampak salah — sila semak semula carian hakmilik.",
    commentRequired: "Tambah catatan ringkas (5+ aksara) untuk menerangkan keputusan anda.",
    approve: "Luluskan langkah ini", requestChanges: "Minta perubahan", reject: "Hentikan pembelian",
    confirmRejectTitle: "Hentikan pembelian ini?",
    confirmRejectBody: "Transaksi ini akan ditutup secara kekal. Anda tidak boleh membukanya semula, tetapi rekod anda kekal disimpan.",
    confirmRejectYes: "Ya, hentikan pembelian", confirmRejectNo: "Teruskan menyemak",
    refresh: "Semak kemas kini", switchTxn: "Tukar pembelian",
    statusInProgress: "Kami sedang menyediakan semakan seterusnya. Tiada apa diteruskan tanpa kelulusan anda.",
    statusCompleted: "Pembelian selesai. Sejarah keputusan anda disimpan di bawah.",
    statusHalted: "Anda telah menghentikan pembelian ini. Sejarah keputusan anda disimpan di bawah.",
    okCreated: "Pembelian dimulakan. Kami akan meminta semakan anda apabila semakan iklan siap.",
    okApproved: "Langkah diluluskan. Kami sedang menyediakan semakan seterusnya.",
    okApprovedFinal: "Langkah terakhir diluluskan. Pembelian anda selesai.",
    okChanges: "Perubahan diminta. Langkah ini akan kembali kepada anda setelah dikemas kini.",
    okRejected: "Pembelian dihentikan. Transaksi ini kini ditutup.",
    historyTitle: "Sejarah keputusan",
    historyEmpty: "Belum ada keputusan. Setiap kelulusan anda akan dipaparkan di sini.",
    chainOk: "Rekod utuh", chainBad: "Rekod diubah",
    chainOkHint: "Setiap keputusan dimeterai dengan kod semakan. Sebarang perubahan pada keputusan lalu akan kelihatan di sini.",
    chainBadHint: "Keputusan lalu tidak sepadan dengan kod semakannya. Jangan teruskan — hubungi sokongan.",
    colStep: "Langkah", colDecision: "Keputusan", colWhen: "Tarikh", colCode: "Kod semakan",

    calcTitle: "Tunai dan Duti Setem",
    calcSub: "Lihat jumlah tunai yang anda perlukan dan bilakah. Angka menggunakan kadar Malaysia, setiap satu ditanda mengikut kepastiannya.",
    price: "Harga Belian (RM)", mv: "Nilai Penilaian (RM)", mvHint: "Biarkan kosong jika hartanah belum dinilai.",
    loan: "Jumlah Pinjaman (RM)", ptype: "Jenis Hartanah", house: "Rumah", vacant: "Tanah kosong", agri: "Tanah pertanian",
    buyer: "Anda Seorang", citizen: "Warganegara Malaysia", pr: "Penduduk tetap", nonCitizen: "Bukan warganegara",
    spaDate: "Jangkaan Tarikh Tandatangan", spaHint: "Tarikh anda jangka menandatangani SPA (perjanjian jual beli).",
    moneyInvalid: "Masukkan jumlah dalam ringgit, contohnya 450000 atau 450000.50",
    eligibility: "Tentang anda dan hartanah",
    ftb: "Ini rumah pertama saya",
    never: "Saya tidak pernah memiliki rumah — termasuk melalui warisan, hadiah atau pemilikan bersama",
    consent: "Hakmilik memerlukan kebenaran Negeri untuk dipindah milik",
    survey: "Tambah ukur sempadan",
    b2027: "Papar juga cadangan Bajet 2027 (belum menjadi undang-undang)",
    calculate: "Kira kos", calculating: "Sedang mengira…",
    calcEmpty: "Masukkan harga dan pinjaman, kemudian kira untuk melihat tunai yang anda perlukan.",
    atSigning: "Tunai semasa tandatangan", total: "Jumlah tunai diperlukan", duty: "Duti setem pindah milik",
    exemptOk: "Pengecualian rumah pertama terpakai. Duti setem pindah milik turun daripada {from} kepada {to}.",
    gapWarn: "Nilai penilaian {gap} lebih rendah daripada harga. Bank memberi pinjaman berdasarkan angka lebih rendah, jadi sediakan tunai untuk jurang ini.",
    colItem: "Kos", colWhenPay: "Bila", colBasis: "Kepastian", colAmount: "Jumlah",
    proposedBadge: "Belum menjadi undang-undang",
    proposedTitle: "Cadangan Bajet 2027",
    proposedBody: "Jika menjadi undang-undang, duti pindah milik ialah {mot} dan duti pinjaman {loan}. Anda jimat {save}.",
    proposedNA: "Cadangan ini tidak terpakai untuk pembelian anda.",
    proposedCaution: "Jangan bajet berdasarkan angka ini sehingga peguam anda mengesahkan ia telah menjadi undang-undang.",
    rulesetNote: "Kadar daripada set peraturan {v}",

    vaultTitle: "Dokumen",
    vaultSub: "Jejaki dokumen yang anda ada bagi setiap langkah. Menambah fail mencipta cap jari dalam pelayar anda supaya anda boleh membuktikan ia tidak diubah. Fail tidak dimuat naik.",
    vaultStep: "Papar dokumen untuk",
    vaultCount: "{n} daripada {total} sedia",
    addFile: "Tambah fail", fileFor: "Tambah fail untuk {doc}",
    fileTypeErr: "Jenis fail itu tidak disokong. Pilih fail PDF, JPG, PNG atau teks.",
    fileSizeErr: "Fail itu terlalu besar. Pilih fail di bawah 25 MB.",
    fingerprint: "Cap jari",
    readTitle: "Baca Carian Hakmilik",
    readTitleBody: "Tampal teks daripada carian rasmi hakmilik anda. Kami akan mengeluarkan fakta utama untuk anda semak.",
    pasteLabel: "Teks Carian Hakmilik",
    readBtn: "Baca carian hakmilik",
    verifyFacts: "Dibaca oleh komputer. Semak setiap fakta dengan dokumen asal sebelum bergantung padanya.",
    found: "Dijumpai", notFound: "Tidak dijumpai",

    dirTitle: "Sumber Rasmi",
    dirSub: "Agensi kerajaan dan peraturan yang berkaitan dengan pembelian anda. Setiap satu menunjukkan bila ia terakhir disemak.",
    allCats: "Semua topik", allStates: "Semua negeri", filterCat: "Topik", filterState: "Negeri",
    lastVerified: "Terakhir disemak", notVerified: "Belum disemak",
    dirEmpty: "Tiada sumber sepadan dengan penapis ini. Cuba “Semua topik” atau “Semua negeri”.",
    visitSite: "Layari {host}", opensNewTab: "(dibuka dalam tab baharu)",
    footer: "Dibina untuk membantu anda membeli dengan selamat. Peguam anda membuat keputusan akhir.",

    errSignedOut: "Anda telah log keluar. Log masuk semula untuk meneruskan.",
    errBlocked: "Permintaan disekat demi keselamatan anda. Muat semula halaman dan cuba lagi.",
    errEngine: "Enjin kos tidak dapat dihubungi sekarang. Kami tidak akan meneka angka anda. Cuba lagi sebentar.",
    errRate: "Terlalu banyak permintaan. Tunggu seminit, kemudian cuba lagi.",
    errTooLarge: "Teks itu terlalu panjang. Tampal halaman carian hakmilik sahaja.",
    errNotFound: "Pembelian tidak dijumpai. Semak ID transaksi, atau mulakan pembelian baharu.",
    errStale: "Langkah ini berubah semasa anda menyemaknya. Kami telah memuatkan versi terkini — semak, kemudian buat keputusan semula.",
    errBlocking: "Belum boleh diluluskan. Selesaikan risiko mesti-dibaiki dahulu, atau hentikan pembelian.",
    errUnacked: "Tandakan setiap amaran untuk mengesahkan anda telah membacanya, kemudian luluskan.",
    errComment: "Tambah catatan ringkas tentang apa yang perlu diubah.",
    errNotPaused: "Langkah ini tidak lagi menunggu keputusan. Semak kemas kini untuk melihat statusnya.",
    errInvalid: "Semak angka anda. {msg}",
    errValidation: "Sesetengah butiran tidak sah. Semak medan yang ditanda dan cuba lagi.",
    errGeneric: "Permintaan tidak berjaya. Cuba lagi sebentar.",
  },
} as const;

export type Dict = { [K in keyof (typeof T)["en"]]: string };

/** Fill {placeholders} in a copy string. */
export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Map any API failure to actionable, bilingual copy. Never shows raw codes or stack text. */
export function errorCopy(e: unknown, t: Dict): string {
  if (!(e instanceof ApiError)) return t.errGeneric;
  switch (e.code) {
    case "unauthenticated": return t.errSignedOut;
    case "csrf_rejected": return t.errBlocked;
    case "rate_limited": return t.errRate;
    case "payload_too_large": return t.errTooLarge;
    case "NOT_FOUND": return t.errNotFound;
    case "STALE_VERSION": case "STALE_GATE": return t.errStale;
    case "BLOCKING_FLAGS": return t.errBlocking;
    case "UNACKNOWLEDGED_WARNINGS": return t.errUnacked;
    case "COMMENT_REQUIRED": return t.errComment;
    case "NOT_PAUSED": case "NOT_IN_PROGRESS": return t.errNotPaused;
    case "INVALID_INPUT": return fmt(t.errInvalid, { msg: e.message }); // engine messages are user-safe
    case "VALIDATION": return t.errValidation;
  }
  if (e.status === 404) return t.errNotFound;
  if (e.status === 401) return t.errSignedOut;
  if (e.status === 429) return t.errRate;
  if (e.status >= 500) return t.errEngine;
  return t.errGeneric;
}

/** Unambiguous dates: "26 November 2026" (month spelled out, no ordinals). */
export function fmtDate(iso: string, lang: Lang, withTime = false): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "ms" ? "ms-MY" : "en-MY", {
    day: "numeric", month: "long", year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
