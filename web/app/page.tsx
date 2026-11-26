"use client";

// Single-page Buyer Command Hub.
//  1. Approvals (HITL console)   2. Costs (cash & stamp duty)   3. Documents   4. Official sources
//
// Principles: the browser never computes money (the engine is the single source of truth),
// never holds secrets, and never takes a consequential action without an explicit,
// confirmable human click. All user-facing copy lives in lib/copilot.ts (EN/BM).

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api, ApiError, Approval, BASIS_LABEL, CATEGORY_LABEL, cleanMoney, Cost, DECISION_LABEL, DecisionCode, Dict,
  DirectoryEntry, DOCS_BY_GATE, errorCopy, FACT_LABEL, Flag, fmt, fmtDate, FRESHNESS_LABEL, GATE_INTRO, GATE_LABEL,
  GateCode, GATES, Lang, LINE_LABEL, LINE_NOTE, newIdempotencyKey, PAYABLE_LABEL, rm, SEVERITY_LABEL, STATE_LABEL,
  STATUS_LABEL, T, TENURE_LABEL, Transaction,
} from "@/lib/copilot";

const SEV_BADGE: Record<string, string> = { BLOCK: "b-block", WARN: "b-warn", INFO: "b-info" };
const SEV_ICON: Record<string, string> = { BLOCK: "✕", WARN: "!", INFO: "i" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  useEffect(() => { document.documentElement.lang = lang; safeSet("copilot.lang", lang); }, [lang]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <h1>{t.appTitle}</h1>
            <small>{t.appSub}</small>
          </div>
          <div className="toolbar">
            <div className="seg" role="group" aria-label={t.langGroup}>
              <button type="button" aria-pressed={lang === "en"} aria-label={t.langEn} lang="en" onClick={() => setLang("en")}>EN</button>
              <button type="button" aria-pressed={lang === "ms"} aria-label={t.langMs} lang="ms" onClick={() => setLang("ms")}>BM</button>
            </div>
          </div>
        </div>
        <nav className="nav" aria-label={t.stepsLabel}>
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

        <ApprovalConsole lang={lang} t={t} txnId={txnId}
                         onTxn={(id) => { setTxnId(id); safeSet("copilot.txn", id ?? ""); }} onStage={setStage} />
        <CostCalculator lang={lang} t={t} onRuleset={setRuleset} />
        <DocumentVault lang={lang} t={t} stage={stage} txnId={txnId} />
        <Directory lang={lang} t={t} />

        <footer>
          <p><strong>{t.disclaimerLead}</strong> {t.footer}</p>
          {ruleset && <p className="mono">{fmt(t.rulesetNote, { v: ruleset })}</p>}
        </footer>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ 1. Approvals */

function ApprovalConsole({ lang, t, txnId, onTxn, onStage }: {
  lang: Lang; t: Dict; txnId: string | null; onTxn: (id: string | null) => void; onStage: (g: GateCode) => void;
}) {
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [chainValid, setChainValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [commentErr, setCommentErr] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [title, setTitle] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupTouched, setLookupTouched] = useState(false);

  const load = useCallback(async (id: string) => {
    try {
      const r = await api<{ transaction: Transaction; approvals: Approval[]; audit_chain_valid: boolean }>(`transactions/${id}`);
      setTxn(r.transaction); setApprovals(r.approvals); setChainValid(r.audit_chain_valid);
      onStage(r.transaction.stage);
    } catch (e) {
      setTxn(null);
      setError(errorCopy(e, t));
    }
  }, [onStage, t]);

  useEffect(() => { if (txnId) { setError(null); void load(txnId); } }, [txnId, load]);
  // Reset per-step inputs whenever the pending step/version changes (prevents stale acknowledgements).
  useEffect(() => { setAcks(new Set()); setComment(""); setCommentErr(false); setConfirmReject(false); }, [txn?.stage, txn?.version]);

  const blocking = useMemo(() => (txn?.flags ?? []).filter((f) => f.severity === "BLOCK"), [txn]);
  const warnings = useMemo(() => (txn?.flags ?? []).filter((f) => f.severity === "WARN"), [txn]);
  const unacked = warnings.filter((w) => !acks.has(w.code)).length;
  const paused = txn?.status === "PAUSED_FOR_HITL";
  const canApprove = paused && blocking.length === 0 && unacked === 0 && !busy;
  const commentOk = comment.trim().length >= 5;
  const lookupOk = UUID_RE.test(lookup.trim());

  async function create(e: FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      const r = await api<Transaction>("transactions", { method: "POST", body: { title: title.trim() } });
      onTxn(r.id); setTitle(""); setSuccess(t.okCreated);
    } catch (err) { setError(errorCopy(err, t)); } finally { setBusy(false); }
  }

  async function decide(decision: DecisionCode) {
    if (!txn) return;
    if (decision !== "APPROVED" && !commentOk) { setCommentErr(true); return; }
    if (decision === "REJECTED" && !confirmReject) { setConfirmReject(true); return; }
    setBusy(true); setError(null); setSuccess(null); setConfirmReject(false);
    const wasFinal = txn.stage === GATES[GATES.length - 1];
    try {
      await api(`transactions/${txn.id}/decisions`, {
        method: "POST",
        body: {
          gate: txn.stage, decision, comment: comment.trim(), acknowledged_flags: [...acks],
          idempotency_key: newIdempotencyKey(), expected_version: txn.version,
        },
      });
      setSuccess(decision === "APPROVED" ? (wasFinal ? t.okApprovedFinal : t.okApproved)
        : decision === "CHANGES_REQUESTED" ? t.okChanges : t.okRejected);
      await load(txn.id);
    } catch (err) {
      setError(errorCopy(err, t));
      if (err instanceof ApiError && err.status === 409) await load(txn.id); // stale: show latest
    } finally { setBusy(false); }
  }

  const stepState = (i: number): "done" | "current" | "todo" | "halted" => {
    if (!txn) return "todo";
    const cur = GATES.indexOf(txn.stage);
    if (txn.status === "HALTED" && i === cur) return "halted";
    if (i < cur || txn.status === "COMPLETED") return "done";
    return i === cur ? "current" : "todo";
  };
  const stepSr = { done: t.stepDone, current: t.stepCurrent, todo: t.stepTodo, halted: t.stepStopped };

  return (
    <section id="console" className="section" aria-labelledby="console-h">
      <div className="section-head">
        <div>
          <h2 id="console-h">{t.consoleTitle}</h2>
          <p>{t.consoleSub}</p>
        </div>
      </div>

      <ol className="stepper" aria-label={t.stepsLabel}>
        {GATES.map((g, i) => {
          const s = stepState(i);
          return (
            <li key={g} className="step" data-state={s} aria-current={s === "current" ? "step" : undefined}>
              <span className="step-n" aria-hidden="true">{s === "done" ? "✓" : i + 1}</span>
              <b>{GATE_LABEL[g][lang]}</b>
              <span className="sr-only">, {stepSr[s]}</span>
            </li>
          );
        })}
      </ol>

      <div aria-live="polite">
        {error && <div className="alert alert-block" role="alert">{error}</div>}
        {success && !error && <div className="alert alert-ok" role="status">✓ {success}</div>}
      </div>

      {!txn ? (
        <div className="grid-2">
          <form className="card" onSubmit={create}>
            <h3>{t.newTxnHeading}</h3>
            <p className="muted">{t.newTxnBody}</p>
            <div className="field">
              <label htmlFor="txn-title">{t.txnTitle}</label>
              <input id="txn-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)}
                     placeholder={t.txnTitlePh} autoComplete="off" />
            </div>
            <button className="btn-primary" type="submit" disabled={busy || title.trim().length < 3}>{t.newTxn}</button>
          </form>
          <form className="card" onSubmit={(e) => { e.preventDefault(); setLookupTouched(true); if (lookupOk) { setError(null); onTxn(lookup.trim()); } }}>
            <h3>{t.openTxnHeading}</h3>
            <p className="muted">{t.openTxnBody}</p>
            <div className="field">
              <label htmlFor="txn-id">{t.txnId}</label>
              <input id="txn-id" type="text" className="mono" value={lookup} autoComplete="off" spellCheck={false}
                     aria-invalid={lookupTouched && !lookupOk} aria-describedby={lookupTouched && !lookupOk ? "txn-id-err" : undefined}
                     onChange={(e) => setLookup(e.target.value)} onBlur={() => setLookupTouched(lookup.trim() !== "")} />
              {lookupTouched && !lookupOk && <span id="txn-id-err" className="field-error">{t.txnIdInvalid}</span>}
            </div>
            <button type="submit">{t.openTxn}</button>
          </form>
        </div>
      ) : (
        <div className="grid-2">
          <div className="card">
            <div className="section-head" style={{ marginBottom: 4 }}>
              <h3>{txn.title}</h3>
              <StatusBadge status={txn.status} lang={lang} />
            </div>
            <p className="muted mono">{t.idLabel} {txn.id}</p>
            <p className="eyebrow">{fmt(t.stepOf, { n: txn.gate_index, total: txn.gate_total })}</p>
            <h4 className="step-title">{GATE_LABEL[txn.stage][lang]}</h4>
            <p>{GATE_INTRO[txn.stage][lang]}</p>

            {paused ? (
              <>
                {txn.gate_summary.cash_at_signing && (
                  <div className="kpis" aria-label={t.keyFigures}>
                    <div className="kpi"><span>{t.atSigning}</span><strong className="num">{rm(txn.gate_summary.cash_at_signing)}</strong></div>
                    <div className="kpi"><span>{t.total}</span><strong className="num">{rm(txn.gate_summary.total_cash_to_completion)}</strong></div>
                    <div className="kpi"><span>{t.duty}</span><strong className="num">{rm(txn.gate_summary.mot_duty)}</strong></div>
                  </div>
                )}
                {txn.gate_summary.next_actions?.length ? (
                  <>
                    <h4>{t.nextActions}</h4>
                    <ul>{txn.gate_summary.next_actions.map((a) => <li key={a}>{a}</li>)}</ul>
                  </>
                ) : null}

                {txn.flags.length > 0 && <h4>{t.risksHeading}</h4>}
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

                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="hitl-comment">{t.comment}</label>
                  <span id="hitl-comment-hint" className="hint hint-block">{t.commentHint}</span>
                  <textarea id="hitl-comment" maxLength={2000} value={comment} placeholder={t.commentPh}
                            aria-invalid={commentErr && !commentOk}
                            aria-describedby={`hitl-comment-hint${commentErr && !commentOk ? " hitl-comment-err" : ""}`}
                            onChange={(e) => { setComment(e.target.value); if (commentErr) setCommentErr(false); }} />
                  {commentErr && !commentOk && <span id="hitl-comment-err" className="field-error" role="alert">{t.commentRequired}</span>}
                </div>

                {confirmReject ? (
                  <div className="confirm" role="alertdialog" aria-labelledby="confirm-h" aria-describedby="confirm-b">
                    <h4 id="confirm-h">{t.confirmRejectTitle}</h4>
                    <p id="confirm-b">{t.confirmRejectBody}</p>
                    <div className="actions">
                      <button className="btn-danger-solid" type="button" disabled={busy} onClick={() => decide("REJECTED")} autoFocus>{t.confirmRejectYes}</button>
                      <button type="button" onClick={() => setConfirmReject(false)}>{t.confirmRejectNo}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="actions">
                      <button className="btn-primary" type="button" disabled={!canApprove} aria-describedby="approve-reason"
                              onClick={() => decide("APPROVED")}>{t.approve}</button>
                      <button type="button" disabled={busy} onClick={() => decide("CHANGES_REQUESTED")}>{t.requestChanges}</button>
                      <button className="btn-danger" type="button" disabled={busy} onClick={() => decide("REJECTED")}>{t.reject}</button>
                    </div>
                    {/* Disabled buttons must say why (and how to fix it). */}
                    <p id="approve-reason" className="hint" role="status">
                      {blocking.length > 0 ? fmt(blocking.length === 1 ? t.reasonBlocked1 : t.reasonBlockedN, { n: blocking.length })
                        : unacked > 0 ? fmt(unacked === 1 ? t.reasonWarn1 : t.reasonWarnN, { n: unacked }) : ""}
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className={`alert ${txn.status === "HALTED" ? "alert-warn" : txn.status === "COMPLETED" ? "alert-ok" : "alert-info"}`}>
                {txn.status === "IN_PROGRESS" ? t.statusInProgress : txn.status === "COMPLETED" ? t.statusCompleted : t.statusHalted}
              </p>
            )}
            <div className="actions">
              <button type="button" onClick={() => { setSuccess(null); setError(null); void load(txn.id); }} disabled={busy}>{t.refresh}</button>
              <button type="button" className="btn-link" onClick={() => { onTxn(null); setTxn(null); setSuccess(null); setError(null); }}>{t.switchTxn}</button>
            </div>
          </div>

          <div className="card">
            <div className="section-head" style={{ marginBottom: 4 }}>
              <h3>{t.historyTitle}</h3>
              <span className={`badge ${chainValid ? "b-ok" : "b-block"}`} title={chainValid ? t.chainOkHint : t.chainBadHint}>
                {chainValid ? "✓ " + t.chainOk : "✕ " + t.chainBad}
              </span>
            </div>
            <p className={chainValid ? "hint" : "alert alert-block"}>{chainValid ? t.chainOkHint : t.chainBadHint}</p>
            {approvals.length === 0 ? <p className="empty">{t.historyEmpty}</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th scope="col">{t.colStep}</th><th scope="col">{t.colDecision}</th><th scope="col">{t.colWhen}</th><th scope="col">{t.colCode}</th></tr></thead>
                  <tbody>
                    {[...approvals].reverse().map((a) => (
                      <tr key={a.id}>
                        <td>{GATE_LABEL[a.gate][lang]}{a.comment && <div className="muted">“{a.comment}”</div>}</td>
                        <td><DecisionBadge d={a.decision} lang={lang} /></td>
                        <td>{fmtDate(a.created_at, lang, true)}</td>
                        <td className="mono" title={a.row_hash}>{a.row_hash.slice(0, 8)}</td>
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

function StatusBadge({ status, lang }: { status: Transaction["status"]; lang: Lang }) {
  const cls = { PAUSED_FOR_HITL: "b-warn", IN_PROGRESS: "b-info", COMPLETED: "b-ok", HALTED: "b-block" }[status];
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status][lang]}</span>;
}

function DecisionBadge({ d, lang }: { d: DecisionCode; lang: Lang }) {
  const cls = d === "APPROVED" ? "b-ok" : d === "REJECTED" ? "b-block" : "b-warn";
  return <span className={`badge ${cls}`}>{DECISION_LABEL[d][lang]}</span>;
}

function FlagCard({ f, lang, children }: { f: Flag; lang: Lang; children?: React.ReactNode }) {
  const title = (lang === "ms" ? f.title_ms : f.title_en) || f.title_en || "";
  return (
    <div className="flag" data-sev={f.severity}>
      <span className={`badge ${SEV_BADGE[f.severity] ?? "b-neutral"}`}>
        <span aria-hidden="true" className="badge-icon">{SEV_ICON[f.severity]}</span> {SEVERITY_LABEL[f.severity]?.[lang] ?? ""}
      </span>{" "}
      <strong>{title}</strong>
      <p>{f.message}</p>
      {f.next_step && <p className="next">→ {f.next_step}</p>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ 2. Costs */

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
          first_time_buyer: f.ftb, never_owned_residential: f.ftb && f.never,
          requires_state_consent: f.consent, include_survey: f.survey,
          budget2027_mode: f.b2027 ? "SHOW_PROPOSED_SCENARIO" : "GAZETTED_ONLY",
        },
      });
      setCost(r); onRuleset(r.ruleset_version);
    } catch (e2) {
      setCost(null);
      setErr(errorCopy(e2, t));
    } finally { setBusy(false); }
  }

  const ps = cost?.proposed_scenario as null | { applicable?: boolean; mot_duty?: string; loan_duty?: string; saving_vs_official?: string };
  const gap = cost && cost.valuation_gap !== "0.00" ? cost.valuation_gap : null;

  return (
    <section id="calculator" className="section" aria-labelledby="calc-h">
      <div className="section-head">
        <div><h2 id="calc-h">{t.calcTitle}</h2><p>{t.calcSub}</p></div>
      </div>
      <div className="grid-2">
        <form className="card" onSubmit={run} noValidate>
          <div className="grid-fields">
            <MoneyField id="c-price" label={t.price} value={f.price} onChange={(v) => set("price", v)} invalid={priceOk === null} errText={t.moneyInvalid} />
            <MoneyField id="c-mv" label={t.mv} hint={t.mvHint} value={f.mv} onChange={(v) => set("mv", v)} invalid={mvOk === null} errText={t.moneyInvalid} />
            <MoneyField id="c-loan" label={t.loan} value={f.loan} onChange={(v) => set("loan", v)} invalid={loanOk === null} errText={t.moneyInvalid} />
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
              <input id="c-spa" type="date" value={f.spa} aria-describedby="c-spa-hint" onChange={(e) => set("spa", e.target.value)} />
              <span id="c-spa-hint" className="hint hint-below">{t.spaHint}</span>
            </div>
          </div>
          <fieldset className="checks">
            <legend>{t.eligibility}</legend>
            <label className="check"><input type="checkbox" checked={f.ftb} onChange={(e) => { set("ftb", e.target.checked); if (!e.target.checked) set("never", false); }} />{t.ftb}</label>
            {f.ftb && (
              <label className="check indent"><input type="checkbox" checked={f.never} onChange={(e) => set("never", e.target.checked)} />{t.never}</label>
            )}
            <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />{t.consent}</label>
            <label className="check"><input type="checkbox" checked={f.survey} onChange={(e) => set("survey", e.target.checked)} />{t.survey}</label>
            <label className="check"><input type="checkbox" checked={f.b2027} onChange={(e) => set("b2027", e.target.checked)} />{t.b2027}</label>
          </fieldset>
          <div className="actions">
            <button className="btn-primary" type="submit" disabled={!valid || busy}>{busy ? t.calculating : t.calculate}</button>
          </div>
        </form>

        <div className="card" aria-live="polite">
          {err && <div className="alert alert-block" role="alert">{err}</div>}
          {!cost && !err && <p className="empty">{t.calcEmpty}</p>}
          {cost && (
            <>
              <div className="kpis">
                <div className="kpi"><span>{t.atSigning}</span><strong className="num">{rm(cost.cash_at_signing)}</strong></div>
                <div className="kpi"><span>{t.total}</span><strong className="num">{rm(cost.total_cash_to_completion)}</strong></div>
                <div className="kpi"><span>{t.duty}</span><strong className="num">{rm(cost.mot_duty)}</strong></div>
              </div>
              {cost.exemption_applied && (
                <p className="alert alert-ok">✓ {fmt(t.exemptOk, { from: rm(cost.mot_duty_before_relief), to: rm(cost.mot_duty) })}</p>
              )}
              {gap && <p className="alert alert-warn">{fmt(t.gapWarn, { gap: rm(gap) })}</p>}
              {cost.flags.filter((fl) => fl.code !== "VALUATION_GAP").map((fl) => <FlagCard key={fl.code} f={fl} lang={lang} />)}
              <div className="table-wrap">
                <table>
                  <thead><tr><th scope="col">{t.colItem}</th><th scope="col">{t.colWhenPay}</th><th scope="col">{t.colBasis}</th><th scope="col" className="r">{t.colAmount}</th></tr></thead>
                  <tbody>
                    {cost.line_items.map((li) => {
                      const basis = BASIS_LABEL[li.rule_status];
                      const note = LINE_NOTE[li.key]?.[lang];
                      return (
                        <tr key={li.key}>
                          <td>{LINE_LABEL[li.key]?.[lang] ?? li.label}{note && <div className="muted small">{note}</div>}</td>
                          <td className="nowrap">{PAYABLE_LABEL[li.payable_at]?.[lang] ?? li.payable_at}</td>
                          <td><span className={`badge ${li.rule_status === "GAZETTED" ? "b-ok" : li.rule_status === "ESTIMATE" ? "b-neutral" : "b-warn"}`}
                                    title={basis ? (lang === "ms" ? basis.hint_ms : basis.hint_en) : undefined}>{basis?.[lang] ?? li.rule_status}</span></td>
                          <td className="r num">{rm(li.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {ps && (
                <div className="proposed" role="note">
                  <span className="badge b-warn">{t.proposedBadge}</span> <strong>{t.proposedTitle}</strong>
                  {ps.applicable === false ? <p>{t.proposedNA}</p> : (
                    <>
                      <p>{fmt(t.proposedBody, { mot: rm(ps.mot_duty), loan: rm(ps.loan_duty), save: rm(ps.saving_vs_official) })}</p>
                      <p className="muted">{t.proposedCaution}</p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function MoneyField({ id, label, hint, value, onChange, invalid, errText }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; invalid: boolean; errText: string;
}) {
  const describedBy = [hint ? `${id}-hint` : "", invalid ? `${id}-err` : ""].join(" ").trim() || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value}
             aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
      {hint && <span id={`${id}-hint`} className="hint hint-below">{hint}</span>}
      {invalid && <span id={`${id}-err`} className="field-error">{errText}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ 3. Documents */

interface Fingerprint { name: string; sha256: string; size: number }
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "text/plain"];

function DocumentVault({ lang, t, stage, txnId }: { lang: Lang; t: Dict; stage: GateCode; txnId: string | null }) {
  const [gate, setGate] = useState<GateCode>(stage);
  const storeKey = `copilot.vault.${txnId ?? "draft"}`;
  const [done, setDone] = useState<Record<string, Fingerprint | true>>({});
  const [text, setText] = useState("");
  const [facts, setFacts] = useState<null | { facts: Record<string, unknown>; evidence: Record<string, string> }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<{ key: string; msg: string } | null>(null);

  useEffect(() => setGate(stage), [stage]);
  useEffect(() => {
    try { setDone(JSON.parse(safeGet(storeKey) ?? "{}")); } catch { setDone({}); }
  }, [storeKey]);
  const persist = (n: Record<string, Fingerprint | true>) => { setDone(n); safeSet(storeKey, JSON.stringify(n)); };

  async function fingerprint(key: string, file: File | undefined) {
    setFileErr(null);
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) { setFileErr({ key, msg: t.fileTypeErr }); return; }
    if (file.size > 25 * 1024 * 1024) { setFileErr({ key, msg: t.fileSizeErr }); return; }
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    persist({ ...done, [key]: { name: file.name, sha256: hex, size: file.size } });
  }

  async function interpret(e: FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      setFacts(await api("interpret/title-search", { method: "POST", body: { text: text.slice(0, 200_000) } }));
    } catch (e2) { setErr(errorCopy(e2, t)); }
  }

  const factValue = (k: string, v: unknown): string => {
    if (typeof v === "boolean") return v ? t.found : t.notFound;
    if (k === "tenure") return TENURE_LABEL[String(v)]?.[lang] ?? String(v);
    if (k === "lease_expiry" && typeof v === "string") return fmtDate(v, lang);
    return String(v);
  };

  const docs = DOCS_BY_GATE[gate];
  const count = docs.filter((d) => done[d.key]).length;

  return (
    <section id="vault" className="section" aria-labelledby="vault-h">
      <div className="section-head">
        <div><h2 id="vault-h">{t.vaultTitle}</h2><p>{t.vaultSub}</p></div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="vault-step">{t.vaultStep}</label>
          <select id="vault-step" value={gate} onChange={(e) => setGate(e.target.value as GateCode)} style={{ width: "auto" }}>
            {GATES.map((g, i) => <option key={g} value={g}>{i + 1}. {GATE_LABEL[g][lang]}</option>)}
          </select>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <p className="eyebrow" aria-live="polite">{fmt(t.vaultCount, { n: count, total: docs.length })}</p>
          <progress max={docs.length} value={count} aria-hidden="true" />
          {docs.map((d) => {
            const v = done[d.key];
            const name = lang === "ms" ? d.ms : d.en;
            return (
              <div key={d.key} className="flag" data-sev={v ? "OK" : "TODO"}>
                <label className="check" style={{ fontWeight: 600 }}>
                  <input type="checkbox" checked={!!v} onChange={(e) => {
                    const n = { ...done }; if (e.target.checked) n[d.key] = true; else delete n[d.key]; persist(n);
                  }} />
                  {name}
                </label>
                <label className="file-btn">
                  {t.addFile}
                  <input type="file" className="sr-only" aria-label={fmt(t.fileFor, { doc: name })} accept={ALLOWED_TYPES.join(",")}
                         onChange={(e) => fingerprint(d.key, e.target.files?.[0])} />
                </label>
                {fileErr?.key === d.key && <span className="field-error" role="alert">{fileErr.msg}</span>}
                {v && v !== true && <p className="mono muted small" title={v.sha256}>{v.name} · {t.fingerprint} {v.sha256.slice(0, 12)}</p>}
              </div>
            );
          })}
        </div>
        <form className="card" onSubmit={interpret}>
          <h3>{t.readTitle}</h3>
          <p className="muted">{t.readTitleBody}</p>
          {err && <div className="alert alert-block" role="alert">{err}</div>}
          <div className="field">
            <label htmlFor="ts-text">{t.pasteLabel}</label>
            <textarea id="ts-text" value={text} maxLength={200000} onChange={(e) => setText(e.target.value)}
                      placeholder={"No. Hakmilik: HSD 12345\nTarikh Luput: 14/03/2061\nGadaian kepada …"} />
          </div>
          <button type="submit" disabled={text.trim().length === 0}>{t.readBtn}</button>
          {facts && (
            <div aria-live="polite">
              <p className="alert alert-warn" role="status">{t.verifyFacts}</p>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {Object.entries(facts.facts).map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{FACT_LABEL[k]?.[lang] ?? k}</th>
                        <td>{factValue(k, v)}{facts.evidence[k] && <div className="mono muted small">“{facts.evidence[k]}”</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 4. Official sources */

const FRESH_BADGE: Record<string, string> = {
  VERIFIED: "b-ok", STALE: "b-warn", UNVERIFIED: "b-neutral", PROPOSED_PENDING_GAZETTE: "b-warn", INACTIVE: "b-block",
};
const STATE_FILTERS = Object.keys(STATE_LABEL).filter((s) => s !== "NATIONAL");

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
      .catch((e: unknown) => { if (!cancelled) { setRows(null); setErr(errorCopy(e, t)); } });
    return () => { cancelled = true; };
  }, [cat, st, t]);

  return (
    <section id="directory" className="section" aria-labelledby="dir-h">
      <div className="section-head">
        <div><h2 id="dir-h">{t.dirTitle}</h2><p>{t.dirSub}</p></div>
        <div className="toolbar">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="dir-cat">{t.filterCat}</label>
            <select id="dir-cat" value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: "auto" }}>
              <option value="">{t.allCats}</option>
              {Object.keys(CATEGORY_LABEL).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]![lang]}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="dir-state">{t.filterState}</label>
            <select id="dir-state" value={st} onChange={(e) => setSt(e.target.value)} style={{ width: "auto" }}>
              <option value="">{t.allStates}</option>
              {STATE_FILTERS.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
      </div>
      {err && <div className="alert alert-block" role="alert">{err}</div>}
      {rows && rows.length === 0 && <p className="empty">{t.dirEmpty}</p>}
      <div className="dir-list">
        {rows?.map((r) => {
          const host = new URL(r.official_url).host;
          return (
            <article key={r.agency_name + r.jurisdiction_state} className="card dir-item">
              <div className="dir-meta">
                <span className={`badge ${FRESH_BADGE[r.freshness_status] ?? "b-neutral"}`}>{FRESHNESS_LABEL[r.freshness_status]?.[lang] ?? ""}</span>
                <span>{CATEGORY_LABEL[r.category]?.[lang] ?? r.category}</span>·<span>{STATE_LABEL[r.jurisdiction_state] ?? r.jurisdiction_state}</span>
              </div>
              <h3 style={{ marginTop: 8 }}>{r.agency_name}</h3>
              <p>{r.summary_rule}</p>
              {r.contact_details && <p className="muted">{r.contact_details}</p>}
              <p className="dir-meta">
                {t.lastVerified}: {r.last_verified_date ? fmtDate(r.last_verified_date, lang) : t.notVerified}
              </p>
              {/* rel=noopener noreferrer: no window.opener access, no referrer leak of transaction URLs */}
              <a href={r.official_url} target="_blank" rel="noopener noreferrer">
                {fmt(t.visitSite, { host })} <span aria-hidden="true">↗</span><span className="sr-only"> {t.opensNewTab}</span>
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
}
