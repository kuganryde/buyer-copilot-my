"use client";

// Single-page Buyer Command Hub.
//  1. Stage & HITL approval console   2. Upfront cash & stamp-duty calculator
//  3. Document vault & checklist      4. Live legal/statutory directory
//
// Principles: the browser never computes money (engine is the single source of truth),
// never holds secrets, and never takes a consequential action without an explicit,
// confirmable human click. Engine failures render an honest "unavailable" state.

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api, ApiError, Approval, cleanMoney, Cost, DecisionCode, Dict, DirectoryEntry, DOCS_BY_GATE, Flag,
  GATE_LABEL, GateCode, GATES, Lang, newIdempotencyKey, rm, T, Transaction,
} from "@/lib/copilot";

const SEV_BADGE: Record<string, string> = { BLOCK: "b-block", WARN: "b-warn", INFO: "b-info" };
const SEV_LABEL: Record<string, Record<Lang, string>> = {
  BLOCK: { en: "Blocking", ms: "Menyekat" }, WARN: { en: "Warning", ms: "Amaran" }, INFO: { en: "Info", ms: "Info" },
};

function safeGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* private mode: convenience only */ }
}

export default function BuyerCommandHub() {
  const [lang, setLang] = useState<Lang>("en");
  const t: Dict = T[lang];
  const [txnId, setTxnId] = useState<string | null>(null);
  const [stage, setStage] = useState<GateCode>("HITL_1_LISTING_VETTING");
  const [ruleset, setRuleset] = useState<string>("");

  useEffect(() => {
    const saved = safeGet("copilot.lang");
    if (saved === "ms" || saved === "en") setLang(saved);
    const fromUrl = new URLSearchParams(window.location.search).get("txn");
    setTxnId(fromUrl ?? safeGet("copilot.txn"));
  }, []);
  useEffect(() => { document.documentElement.lang = lang === "ms" ? "ms" : "en"; safeSet("copilot.lang", lang); }, [lang]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <h1>{t.appTitle}</h1>
            <small>{t.appSub}</small>
          </div>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Language / Bahasa">
              <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
              <button type="button" aria-pressed={lang === "ms"} onClick={() => setLang("ms")}>BM</button>
            </div>
          </div>
        </div>
        <nav className="nav" aria-label="Sections">
          <a href="#console">{t.navConsole}</a>
          <a href="#calculator">{t.navCalc}</a>
          <a href="#vault">{t.navVault}</a>
          <a href="#directory">{t.navDir}</a>
        </nav>
      </header>

      <main className="shell">
        <div className="disclaimer" role="note">
          <strong>{t.disclaimerLead}</strong> {t.disclaimer}
        </div>

        <ApprovalConsole lang={lang} t={t} txnId={txnId} onTxn={(id) => { setTxnId(id); if (id) safeSet("copilot.txn", id); }}
                         onStage={setStage} />
        <CostCalculator lang={lang} t={t} onRuleset={setRuleset} />
        <DocumentVault lang={lang} t={t} stage={stage} txnId={txnId} />
        <Directory lang={lang} t={t} />

        <footer>
          <p>{t.disclaimerLead} {t.disclaimer}</p>
          {ruleset && <p className="mono">{t.footer}: {ruleset}</p>}
        </footer>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ 1. Approval console */

function ApprovalConsole({ lang, t, txnId, onTxn, onStage }: {
  lang: Lang; t: Dict; txnId: string | null; onTxn: (id: string | null) => void; onStage: (g: GateCode) => void;
}) {
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [chainValid, setChainValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [title, setTitle] = useState("");
  const [lookup, setLookup] = useState("");

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      const r = await api<{ transaction: Transaction; approvals: Approval[]; audit_chain_valid: boolean }>(`transactions/${id}`);
      setTxn(r.transaction); setApprovals(r.approvals); setChainValid(r.audit_chain_valid);
      onStage(r.transaction.stage);
    } catch (e) {
      setTxn(null);
      setError(e instanceof ApiError && e.status === 404 ? "Transaction not found." : (e as Error).message);
    }
  }, [onStage]);

  useEffect(() => { if (txnId) void load(txnId); }, [txnId, load]);
  // Reset per-gate inputs whenever the pending gate/version changes (prevents stale acks).
  useEffect(() => { setAcks(new Set()); setComment(""); }, [txn?.stage, txn?.version]);

  const blocking = useMemo(() => (txn?.flags ?? []).filter((f) => f.severity === "BLOCK"), [txn]);
  const warnings = useMemo(() => (txn?.flags ?? []).filter((f) => f.severity === "WARN"), [txn]);
  const allAcked = warnings.every((w) => acks.has(w.code));
  const paused = txn?.status === "PAUSED_FOR_HITL";
  const canApprove = paused && blocking.length === 0 && allAcked && !busy;
  const commentOk = comment.trim().length >= 5;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      const r = await api<Transaction>("transactions", { method: "POST", body: { title: title.trim() } });
      onTxn(r.id); setTitle("");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  async function decide(decision: DecisionCode) {
    if (!txn) return;
    if (decision === "REJECTED" && !window.confirm(t.confirmReject)) return;
    setBusy(true); setError(null);
    try {
      await api(`transactions/${txn.id}/decisions`, {
        method: "POST",
        body: {
          gate: txn.stage, decision, comment: comment.trim(), acknowledged_flags: [...acks],
          // Fresh key per click; the engine dedupes retries of the same request.
          idempotency_key: newIdempotencyKey(), expected_version: txn.version,
        },
      });
      await load(txn.id);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && err.status === 409) await load(txn.id); // stale: refresh view
    } finally { setBusy(false); }
  }

  const stepState = (g: GateCode, i: number): string => {
    if (!txn) return "todo";
    const cur = GATES.indexOf(txn.stage);
    if (txn.status === "HALTED" && i === cur) return "halted";
    if (i < cur || txn.status === "COMPLETED") return "done";
    return i === cur ? "current" : "todo";
  };

  return (
    <section id="console" className="section" aria-labelledby="console-h">
      <div className="section-head">
        <div>
          <h2 id="console-h">{t.consoleTitle}</h2>
          <p>{t.consoleSub}</p>
        </div>
      </div>

      <ol className="stepper" aria-label="HITL gates">
        {GATES.map((g, i) => (
          <li key={g} className="step" data-state={stepState(g, i)} aria-current={stepState(g, i) === "current" ? "step" : undefined}>
            <b>{GATE_LABEL[g][lang]}</b>
            <span className="sr-only">{stepState(g, i)}</span>
          </li>
        ))}
      </ol>

      {error && <div className="alert alert-block" role="alert">{error}</div>}

      {!txn ? (
        <div className="grid-2">
          <form className="card" onSubmit={create}>
            <h3>{t.newTxn}</h3>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="txn-title">{t.txnTitle}</label>
              <input id="txn-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)}
                     placeholder="e.g. Teres 2 tingkat, Kajang" />
            </div>
            <button className="btn-primary" type="submit" disabled={busy || title.trim().length < 3}>{t.newTxn}</button>
          </form>
          <form className="card" onSubmit={(e) => { e.preventDefault(); if (/^[0-9a-f-]{36}$/i.test(lookup.trim())) onTxn(lookup.trim()); }}>
            <h3>{t.openTxn}</h3>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="txn-id">Transaction ID</label>
              <input id="txn-id" type="text" className="mono" value={lookup} onChange={(e) => setLookup(e.target.value)} />
            </div>
            <button type="submit" disabled={!/^[0-9a-f-]{36}$/i.test(lookup.trim())}>{t.load}</button>
            <p className="muted" style={{ marginTop: 12 }}>{t.noTxn}</p>
          </form>
        </div>
      ) : (
        <div className="grid-2">
          <div className="card" aria-live="polite">
            <div className="section-head" style={{ marginBottom: 4 }}>
              <h3>{txn.title}</h3>
              <StatusBadge status={txn.status} t={t} />
            </div>
            <p className="muted mono">ID {txn.id} · v{txn.version}</p>
            <p><strong>{GATE_LABEL[txn.stage][lang]}</strong> — {txn.gate_description[lang]}</p>

            {paused ? (
              <>
                {txn.gate_summary.headline && <p className="alert alert-info">{txn.gate_summary.headline}</p>}
                {txn.gate_summary.cash_at_signing && (
                  <div className="kpis">
                    <div className="kpi"><span>{t.atSigning}</span><strong className="num">{rm(txn.gate_summary.cash_at_signing)}</strong></div>
                    <div className="kpi"><span>{t.total}</span><strong className="num">{rm(txn.gate_summary.total_cash_to_completion)}</strong></div>
                    <div className="kpi"><span>{t.duty}</span><strong className="num">{rm(txn.gate_summary.mot_duty)}</strong></div>
                  </div>
                )}
                {txn.gate_summary.next_actions?.length ? (
                  <ul>{txn.gate_summary.next_actions.map((a) => <li key={a}>{a}</li>)}</ul>
                ) : null}

                {txn.flags.map((f) => (
                  <FlagCard key={f.code} f={f} lang={lang}>
                    {f.severity === "WARN" && (
                      <label className="check">
                        <input type="checkbox" checked={acks.has(f.code)}
                               onChange={(e) => setAcks((s) => { const n = new Set(s); if (e.target.checked) n.add(f.code); else n.delete(f.code); return n; })} />
                        {t.ack}
                      </label>
                    )}
                  </FlagCard>
                ))}

                {blocking.length > 0 && <p className="alert alert-block" role="status">{t.blocking}</p>}

                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="hitl-comment">{t.comment} <span className="hint">— {t.commentHint}</span></label>
                  <textarea id="hitl-comment" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>
                <div className="actions">
                  <button className="btn-primary" type="button" disabled={!canApprove} onClick={() => decide("APPROVED")}>{t.approve}</button>
                  <button type="button" disabled={busy || !commentOk} onClick={() => decide("CHANGES_REQUESTED")}>{t.requestChanges}</button>
                  <button className="btn-danger" type="button" disabled={busy || !commentOk} onClick={() => decide("REJECTED")}>{t.reject}</button>
                </div>
              </>
            ) : (
              <p className="alert alert-info">
                {txn.status === "IN_PROGRESS" ? t.inProgress : txn.status === "COMPLETED" ? t.completed : t.halted}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => load(txn.id)} disabled={busy}>↻ Refresh</button>
              <button type="button" onClick={() => { onTxn(null); setTxn(null); }}>{t.openTxn}</button>
            </div>
          </div>

          <div className="card">
            <div className="section-head" style={{ marginBottom: 4 }}>
              <h3>{t.history}</h3>
              <span className={`badge ${chainValid ? "b-ok" : "b-block"}`}>{chainValid ? "✓ " + t.chainOk : "✕ " + t.chainBad}</span>
            </div>
            {approvals.length === 0 ? <p className="empty">—</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>Gate</th><th>Decision</th><th>When</th><th>Hash</th></tr></thead>
                  <tbody>
                    {[...approvals].reverse().map((a) => (
                      <tr key={a.id}>
                        <td className="num">{a.seq}</td>
                        <td>{GATE_LABEL[a.gate][lang]}{a.comment && <div className="muted">“{a.comment}”</div>}</td>
                        <td><DecisionBadge d={a.decision} /></td>
                        <td className="num">{new Date(a.created_at).toLocaleString(lang === "ms" ? "ms-MY" : "en-MY")}</td>
                        <td className="mono" title={a.row_hash}>{a.row_hash.slice(0, 10)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status, t }: { status: Transaction["status"]; t: Dict }) {
  const map = {
    PAUSED_FOR_HITL: ["b-warn", t.pending], IN_PROGRESS: ["b-info", "In progress"],
    COMPLETED: ["b-ok", "Completed"], HALTED: ["b-block", "Halted"],
  } as const;
  const [cls, label] = map[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function DecisionBadge({ d }: { d: DecisionCode }) {
  const cls = d === "APPROVED" ? "b-ok" : d === "REJECTED" ? "b-block" : "b-warn";
  return <span className={`badge ${cls}`}>{d.replace("_", " ")}</span>;
}

function FlagCard({ f, lang, children }: { f: Flag; lang: Lang; children?: React.ReactNode }) {
  const title = (lang === "ms" ? f.title_ms : f.title_en) || f.code;
  return (
    <div className="flag" data-sev={f.severity}>
      <span className={`badge ${SEV_BADGE[f.severity] ?? "b-neutral"}`}>{SEV_LABEL[f.severity]?.[lang] ?? f.severity}</span>{" "}
      <strong>{title}</strong>
      <p>{f.message}</p>
      {f.next_step && <p className="next">→ {f.next_step}</p>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ 2. Calculator */

interface CalcForm {
  price: string; mv: string; loan: string; ptype: string; buyer: string; spa: string;
  ftb: boolean; never: boolean; consent: boolean; survey: boolean; b2027: boolean;
}

function CostCalculator({ lang, t, onRuleset }: { lang: Lang; t: Dict; onRuleset: (v: string) => void }) {
  const [f, setF] = useState<CalcForm>({
    price: "500000", mv: "", loan: "450000", ptype: "RESIDENTIAL_HOUSE", buyer: "CITIZEN",
    spa: new Date().toISOString().slice(0, 10), ftb: false, never: false, consent: false, survey: false, b2027: false,
  });
  const [cost, setCost] = useState<Cost | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CalcForm>(k: K, v: CalcForm[K]) => setF((s) => ({ ...s, [k]: v }));

  const priceOk = cleanMoney(f.price);
  const loanOk = cleanMoney(f.loan || "0");
  const mvOk = f.mv.trim() === "" ? "" : cleanMoney(f.mv);
  const valid = priceOk !== null && loanOk !== null && mvOk !== null;

  async function run(e?: FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<Cost>("calculate", {
        method: "POST",
        body: {
          purchase_price: priceOk, loan_amount: loanOk, ...(mvOk ? { market_value: mvOk } : {}),
          property_type: f.ptype, buyer_status: f.buyer, spa_date: f.spa,
          first_time_buyer: f.ftb, never_owned_residential: f.never,
          requires_state_consent: f.consent, include_survey: f.survey,
          budget2027_mode: f.b2027 ? "SHOW_PROPOSED_SCENARIO" : "GAZETTED_ONLY",
        },
      });
      setCost(r); onRuleset(r.ruleset_version);
    } catch (e2) {
      setCost(null);
      setErr(e2 instanceof ApiError && e2.status >= 500 ? t.engineDown : (e2 as Error).message);
    } finally { setBusy(false); }
  }

  const ps = cost?.proposed_scenario as null | { applicable?: boolean; mot_duty?: string; loan_duty?: string; saving_vs_official?: string; warning?: string };
  const gap = cost && cost.valuation_gap !== "0.00" ? cost.valuation_gap : null;

  return (
    <section id="calculator" className="section" aria-labelledby="calc-h">
      <div className="section-head">
        <div><h2 id="calc-h">{t.calcTitle}</h2><p>{t.calcSub}</p></div>
      </div>
      <div className="grid-2">
        <form className="card" onSubmit={run} noValidate>
          <div className="grid-fields">
            <MoneyField id="c-price" label={t.price} value={f.price} onChange={(v) => set("price", v)} invalid={priceOk === null} />
            <MoneyField id="c-mv" label={t.mv} hint={t.mvHint} value={f.mv} onChange={(v) => set("mv", v)} invalid={mvOk === null} />
            <MoneyField id="c-loan" label={t.loan} value={f.loan} onChange={(v) => set("loan", v)} invalid={loanOk === null} />
          </div>
          <div className="grid-fields">
            <div className="field">
              <label htmlFor="c-ptype">{t.ptype}</label>
              <select id="c-ptype" value={f.ptype} onChange={(e) => set("ptype", e.target.value)}>
                <option value="RESIDENTIAL_HOUSE">{t.house}</option>
                <option value="VACANT_LAND">{t.vacant}</option>
                <option value="AGRICULTURAL_LAND">{t.agri}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-buyer">{t.buyer}</label>
              <select id="c-buyer" value={f.buyer} onChange={(e) => set("buyer", e.target.value)}>
                <option value="CITIZEN">{t.citizen}</option>
                <option value="PERMANENT_RESIDENT">{t.pr}</option>
                <option value="NON_CITIZEN">{t.nonCitizen}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-spa">{t.spaDate}</label>
              <input id="c-spa" type="date" value={f.spa} onChange={(e) => set("spa", e.target.value)} />
            </div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sr-only">Eligibility</legend>
            <label className="check"><input type="checkbox" checked={f.ftb} onChange={(e) => set("ftb", e.target.checked)} />{t.ftb}</label>
            <label className="check"><input type="checkbox" checked={f.never} disabled={!f.ftb} onChange={(e) => set("never", e.target.checked)} />{t.never}</label>
            <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />{t.consent}</label>
            <label className="check"><input type="checkbox" checked={f.survey} onChange={(e) => set("survey", e.target.checked)} />{t.survey}</label>
            <label className="check"><input type="checkbox" checked={f.b2027} onChange={(e) => set("b2027", e.target.checked)} />{t.b2027}</label>
          </fieldset>
          <div className="actions">
            <button className="btn-primary" type="submit" disabled={!valid || busy}>{busy ? "…" : t.calculate}</button>
          </div>
        </form>

        <div className="card" aria-live="polite">
          {err && <div className="alert alert-block" role="alert">{err}</div>}
          {!cost && !err && <p className="empty">{t.calculate} →</p>}
          {cost && (
            <>
              <div className="kpis">
                <div className="kpi"><span>{t.atSigning}</span><strong className="num">{rm(cost.cash_at_signing)}</strong></div>
                <div className="kpi"><span>{t.total}</span><strong className="num">{rm(cost.total_cash_to_completion)}</strong></div>
                <div className="kpi"><span>{t.duty}</span><strong className="num">{rm(cost.mot_duty)}</strong></div>
              </div>
              {cost.exemption_applied && (
                <p className="alert alert-info">
                  <span className="badge b-ok">Exempt</span> {cost.exemption_applied} — {rm(cost.mot_duty_before_relief)} → {rm(cost.mot_duty)}
                </p>
              )}
              {gap && (
                <p className="alert alert-warn"><strong>Valuation gap {rm(gap)}</strong> — banks lend on {rm(cost.lendable_value)}; duty assessed on {rm(cost.assessed_value)}.</p>
              )}
              {cost.flags.map((fl) => <FlagCard key={fl.code} f={fl} lang={lang} />)}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Item</th><th>When</th><th>Basis</th><th className="r">Amount</th></tr></thead>
                  <tbody>
                    {cost.line_items.map((li) => (
                      <tr key={li.key}>
                        <td>{li.label}{li.note && <div className="muted" style={{ fontSize: "0.8rem" }}>{li.note}</div>}</td>
                        <td><span className="badge b-neutral">{li.payable_at}</span></td>
                        <td><span className={`badge ${li.rule_status === "GAZETTED" ? "b-ok" : li.rule_status === "ESTIMATE" ? "b-neutral" : "b-warn"}`}
                                  title={li.rule_code}>{li.rule_status}</span></td>
                        <td className="r num">{rm(li.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ps && (
                <div className="proposed" role="note">
                  <span className="badge b-warn">PENDING GAZETTE</span> <strong>{t.proposedTitle}</strong>
                  {ps.applicable === false ? <p>{ps.warning}</p> : (
                    <>
                      <p className="num">MOT {rm(ps.mot_duty)} · Loan {rm(ps.loan_duty)} · Δ {rm(ps.saving_vs_official)}</p>
                      <p className="muted">{ps.warning}</p>
                    </>
                  )}
                </div>
              )}
              <p className="muted mono" style={{ marginTop: 12 }}>{cost.ruleset_version}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function MoneyField({ id, label, hint, value, onChange, invalid }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; invalid: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value}
             aria-invalid={invalid} aria-describedby={[hint ? `${id}-hint` : "", invalid ? `${id}-err` : ""].join(" ").trim() || undefined}
             onChange={(e) => onChange(e.target.value)} />
      {hint && <span id={`${id}-hint`} className="hint hint-below">{hint}</span>}
      {invalid && <span id={`${id}-err`} className="hint" style={{ color: "var(--block)" }}>e.g. 450000 or 450000.50</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ 3. Document vault */

interface Fingerprint { name: string; sha256: string; size: number }
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "text/plain"];

function DocumentVault({ lang, t, stage, txnId }: { lang: Lang; t: Dict; stage: GateCode; txnId: string | null }) {
  const [gate, setGate] = useState<GateCode>(stage);
  const storeKey = `copilot.vault.${txnId ?? "draft"}`;
  const [done, setDone] = useState<Record<string, Fingerprint | true>>({});
  const [text, setText] = useState("");
  const [facts, setFacts] = useState<null | { facts: Record<string, unknown>; evidence: Record<string, string> }>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setGate(stage), [stage]);
  useEffect(() => {
    try { setDone(JSON.parse(safeGet(storeKey) ?? "{}")); } catch { setDone({}); }
  }, [storeKey]);
  const persist = (n: Record<string, Fingerprint | true>) => { setDone(n); safeSet(storeKey, JSON.stringify(n)); };

  async function fingerprint(key: string, file: File | undefined) {
    setErr(null);
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) { setErr("Only PDF, JPEG, PNG or plain text."); return; }
    if (file.size > 25 * 1024 * 1024) { setErr("Max 25 MB."); return; }
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    persist({ ...done, [key]: { name: file.name, sha256: hex, size: file.size } });
  }

  async function interpret(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      setFacts(await api("interpret/title-search", { method: "POST", body: { text: text.slice(0, 200_000) } }));
    } catch (e2) { setErr((e2 as Error).message); }
  }

  const docs = DOCS_BY_GATE[gate];
  const count = docs.filter((d) => done[d.key]).length;

  return (
    <section id="vault" className="section" aria-labelledby="vault-h">
      <div className="section-head">
        <div><h2 id="vault-h">{t.vaultTitle}</h2><p>{t.vaultSub}</p></div>
        <select aria-label="Stage" value={gate} onChange={(e) => setGate(e.target.value as GateCode)} style={{ width: "auto" }}>
          {GATES.map((g) => <option key={g} value={g}>{GATE_LABEL[g][lang]}</option>)}
        </select>
      </div>
      {err && <div className="alert alert-block" role="alert">{err}</div>}
      <div className="grid-2">
        <div className="card">
          <p className="muted"><span className="num">{count}/{docs.length}</span> ✓</p>
          {docs.map((d) => {
            const v = done[d.key];
            return (
              <div key={d.key} className="flag" data-sev={v ? "INFO" : "WARN"}>
                <label className="check" style={{ fontWeight: 600 }}>
                  <input type="checkbox" checked={!!v} onChange={(e) => {
                    const n = { ...done }; if (e.target.checked) n[d.key] = true; else delete n[d.key]; persist(n);
                  }} />
                  {lang === "ms" ? d.ms : d.en}
                </label>
                <input type="file" aria-label={`Fingerprint ${d.en}`} accept={ALLOWED_TYPES.join(",")}
                       onChange={(e) => fingerprint(d.key, e.target.files?.[0])} />
                {v && v !== true && <p className="mono muted" title={v.sha256}>{v.name} · SHA-256 {v.sha256.slice(0, 16)}…</p>}
              </div>
            );
          })}
        </div>
        <form className="card" onSubmit={interpret}>
          <div className="field">
            <label htmlFor="ts-text">{t.pasteSearch}</label>
            <textarea id="ts-text" value={text} maxLength={200000} onChange={(e) => setText(e.target.value)}
                      placeholder={"No. Hakmilik: HSD 12345\nTarikh Luput: 14/03/2061\nGadaian kepada …"} />
          </div>
          <button type="submit" disabled={text.trim().length === 0}>{t.interpret}</button>
          {facts && (
            <>
              <p className="alert alert-warn" role="status">{t.verifyFacts}</p>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {Object.entries(facts.facts).map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{k}</th>
                        <td>{String(v)}{facts.evidence[k] && <div className="mono muted">“{facts.evidence[k]}”</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </form>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 4. Directory */

const CATEGORIES = ["STAMP_DUTY_TAX", "LAND_OFFICE", "VALUATION", "LEGAL_PROFESSIONAL", "FINANCING",
  "SURVEY_PLANNING", "LOCAL_COUNCIL_UTILITIES", "LEGISLATION"];
const STATES = ["JOHOR", "KEDAH", "KELANTAN", "MELAKA", "NEGERI_SEMBILAN", "PAHANG", "PENANG", "PERAK", "PERLIS",
  "SABAH", "SARAWAK", "SELANGOR", "TERENGGANU", "WP_KUALA_LUMPUR", "WP_LABUAN", "WP_PUTRAJAYA"];
const FRESH_BADGE: Record<string, string> = {
  VERIFIED: "b-ok", STALE: "b-warn", UNVERIFIED: "b-neutral", PROPOSED_PENDING_GAZETTE: "b-warn", INACTIVE: "b-block",
};
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function Directory({ lang, t }: { lang: Lang; t: Dict }) {
  const [cat, setCat] = useState("");
  const [st, setSt] = useState("");
  const [rows, setRows] = useState<DirectoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (cat) q.set("category", cat);
    if (st) q.set("state", st);
    let cancelled = false;
    api<{ entries: DirectoryEntry[] }>(`directory${q.size ? `?${q}` : ""}`)
      .then((r) => { if (!cancelled) { setRows(r.entries); setErr(null); } })
      .catch((e: Error) => { if (!cancelled) { setRows(null); setErr(e instanceof ApiError && e.status >= 500 ? t.engineDown : e.message); } });
    return () => { cancelled = true; };
  }, [cat, st, t.engineDown]);

  return (
    <section id="directory" className="section" aria-labelledby="dir-h">
      <div className="section-head">
        <div><h2 id="dir-h">{t.dirTitle}</h2><p>{t.dirSub}</p></div>
        <div className="toolbar">
          <select aria-label={t.allCats} value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: "auto" }}>
            <option value="">{t.allCats}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}
          </select>
          <select aria-label={t.allStates} value={st} onChange={(e) => setSt(e.target.value)} style={{ width: "auto" }}>
            <option value="">{t.allStates}</option>
            {STATES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
          </select>
        </div>
      </div>
      {err && <div className="alert alert-block" role="alert">{err}</div>}
      {rows && rows.length === 0 && <p className="empty">—</p>}
      <div className="dir-list">
        {rows?.map((r) => (
          <article key={r.agency_name + r.jurisdiction_state} className="card dir-item">
            <div className="dir-meta">
              <span className={`badge ${FRESH_BADGE[r.freshness_status] ?? "b-neutral"}`}>{pretty(r.freshness_status)}</span>
              <span>{pretty(r.category)}</span>·<span>{pretty(r.jurisdiction_state)}</span>
            </div>
            <h3 style={{ marginTop: 8 }}>{r.agency_name}</h3>
            <p>{r.summary_rule}</p>
            {r.contact_details && <p className="muted">{r.contact_details}</p>}
            <div className="dir-meta">
              <span>{t.lastVerified}: {r.last_verified_date ?? t.notVerified}</span>
            </div>
            {/* rel=noopener noreferrer: no window.opener access, no referrer leak of transaction URLs */}
            <a href={r.official_url} target="_blank" rel="noopener noreferrer">{new URL(r.official_url).host} ↗</a>
          </article>
        ))}
      </div>
    </section>
  );
}
