"use client";

// Brand and orientation sections that frame the working console.
// Everything here is presentational: no money is computed, no network calls are made, and all
// copy comes from lib/copilot.ts (EN/BM). Motion is CSS-only and disabled for reduced-motion users.

import { useState } from "react";
import { Dict, fmt, GATE_INTRO, GATE_LABEL, GATES, Lang, SEVERITY_LABEL, STATUS_LABEL } from "@/lib/copilot";
import { COMPANY, Logo } from "./brand";
import { Icon, IconName } from "./icons";
import { CtaScene, DocumentScene, HeroScene } from "./illustrations";

/* ---------------------------------------------------------------- Hero (Editorial Split) */

export function Hero({ t, lang, returning }: { t: Dict; lang: Lang; returning: boolean }) {
  if (returning) {
    // Returning buyers go straight to their work: a compact welcome keeps a single <h1> on the page.
    return (
      <section className="hero hero-compact" aria-labelledby="hero-h">
        <div className="hero-bg" aria-hidden="true" />
        <div className="wrap">
          <h1 id="hero-h" className="hero-title hero-title-sm">{t.welcomeBack}</h1>
          <p className="hero-sub">{t.welcomeBackSub}</p>
        </div>
      </section>
    );
  }
  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="hero-bg" aria-hidden="true" />
      <div className="wrap">
        {/* Full-width headline: wide measure keeps it to two lines on desktop. The pills are
            decorative (aria-hidden), so the accessible heading is plain, uninterrupted text. */}
        <h1 id="hero-h" className="hero-title">
          {t.heroH1a}{" "}
          <span className="pill pill-key" aria-hidden="true"><Icon name="key" size={30} strokeWidth={1.6} /></span>{" "}
          {t.heroH1b}{" "}
          <span className="pill pill-shield" aria-hidden="true"><Icon name="shield" size={30} strokeWidth={1.6} /></span>{" "}
          {t.heroH1c}
        </h1>

        <div className="hero-split">
          <div className="hero-copy">
            <p className="hero-sub">{t.heroSub}</p>
            <div className="hero-actions">
              <a className="btn btn-primary btn-lg" href="#console">{t.heroCtaPrimary}<Icon name="arrow" size={18} /></a>
              <a className="btn btn-ghost btn-lg" href="#calculator">{t.heroCtaSecondary}</a>
            </div>
            <p className="hero-tag">{t.brandTagline}</p>
            <HeroScene className="hero-scene" />
          </div>
          <HeroCard t={t} lang={lang} />
        </div>
      </div>
    </section>
  );
}

/** Illustration of the real approval screen. Decorative and labelled "Example": it contains no real data. */
function HeroCard({ t, lang }: { t: Dict; lang: Lang }) {
  return (
    <div className="hero-card-wrap" aria-hidden="true">
      <div className="hero-card hero-card-back" />
      <div className="hero-card">
        <div className="hc-top">
          <span className="hc-label">{t.heroCardLabel}</span>
          <span className="badge b-warn"><Icon name="alert" size={13} strokeWidth={2.2} />{STATUS_LABEL.PAUSED_FOR_HITL[lang]}</span>
        </div>
        <ol className="hc-steps">
          {GATES.map((g, i) => (
            <li key={g} data-state={i < 2 ? "done" : i === 2 ? "current" : "todo"}>
              <span className="hc-dot">{i < 2 ? <Icon name="check" size={12} strokeWidth={3} /> : i + 1}</span>
              <span>{GATE_LABEL[g][lang]}</span>
            </li>
          ))}
        </ol>
        <div className="hc-flag" data-sev="BLOCK">
          <span className="badge b-block"><Icon name="x" size={12} strokeWidth={2.6} />{SEVERITY_LABEL.BLOCK[lang]}</span>
          <strong>{t.heroRiskBlock}</strong>
        </div>
        <div className="hc-flag" data-sev="WARN">
          <span className="badge b-warn"><Icon name="alert" size={12} strokeWidth={2.4} />{SEVERITY_LABEL.WARN[lang]}</span>
          <strong>{t.heroRiskWarn}</strong>
        </div>
        <div className="hc-approve">{t.approve}</div>
        <p className="hc-reason">{t.reasonBlocked1}</p>
        <p className="hc-sealed"><Icon name="seal" size={16} />{t.heroSealed}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Sources marquee */

// Real agencies from db/directory_seed.json. Names are proper nouns, so they are not translated.
// This lists sources the app links to. It does not claim endorsement or partnership.
const SOURCES = [
  "LHDN", "STAMPS e-Duti Setem", "JPPH", "NAPIC", "JKPTG", "JUPEM", "PLANMalaysia",
  "Malaysian Bar", "Bank Negara Malaysia", "KPKT", "TNB", "Air Selangor",
];

export function SourcesMarquee({ t }: { t: Dict }) {
  return (
    <section className="marquee-sec" aria-label={t.marqueeLead}>
      <div className="wrap">
        <p className="marquee-lead">{t.marqueeLead}</p>
      </div>
      <div className="marquee">
        {/* One real list for assistive tech; the second copy exists only so the loop has no visible jump. */}
        <ul className="marquee-track">
          {SOURCES.map((s) => <li key={s}>{s}</li>)}
          {SOURCES.map((s) => <li key={`dup-${s}`} aria-hidden="true" className="marquee-dup">{s}</li>)}
        </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Protections (horizontal accordion) */

export function Protections({ t }: { t: Dict }) {
  const items: { icon: IconName; title: string; body: string }[] = [
    { icon: "calc", title: t.p1Title, body: t.p1Body },
    { icon: "shield", title: t.p2Title, body: t.p2Body },
    { icon: "check", title: t.p3Title, body: t.p3Body },
    { icon: "seal", title: t.p4Title, body: t.p4Body },
  ];
  const [open, setOpen] = useState(0);
  return (
    <section className="band" aria-labelledby="protect-h">
      <div className="wrap">
        <div className="band-head">
          <h2 id="protect-h" className="band-title">{t.protectTitle}</h2>
          <p className="band-sub">{t.protectSub}</p>
        </div>
        <div className="acc">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div key={it.title} className="acc-item" data-open={isOpen} onMouseEnter={() => setOpen(i)}>
                <button type="button" className="acc-head" id={`acc-h-${i}`} aria-expanded={isOpen}
                        aria-controls={`acc-p-${i}`} onClick={() => setOpen(i)} onFocus={() => setOpen(i)}>
                  <span className="acc-icon"><Icon name={it.icon} size={22} /></span>
                  <span className="acc-title">{it.title}</span>
                </button>
                <div className="acc-panel" id={`acc-p-${i}`} role="region" aria-labelledby={`acc-h-${i}`}>
                  <p>{it.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Process (pinned split) */

export function Process({ t, lang }: { t: Dict; lang: Lang }) {
  return (
    <section className="band band-alt" aria-labelledby="process-h">
      <div className="wrap process">
        {/* Native position: sticky keeps the title in view while the five steps scroll past. */}
        <div className="process-pin">
          <h2 id="process-h" className="band-title">{t.processTitle}</h2>
          <p className="band-sub">{t.processSub}</p>
          <a className="btn btn-primary" href="#console">{t.heroCtaPrimary}<Icon name="arrow" size={18} /></a>
          <DocumentScene className="process-scene" />
        </div>
        <ol className="process-list">
          {GATES.map((g, i) => (
            <li key={g} className="process-card">
              <span className="process-n" aria-hidden="true">{i + 1}</span>
              <div>
                <p className="process-step">{fmt(t.stepOf, { n: i + 1, total: GATES.length })}</p>
                <h3>{GATE_LABEL[g][lang]}</h3>
                <p>{GATE_INTRO[g][lang]}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Closing CTA + corporate footer */

export function ClosingCta({ t }: { t: Dict }) {
  return (
    <section className="cta" aria-labelledby="cta-h">
      <div className="cta-glow" aria-hidden="true" />
      <div className="wrap cta-inner">
        <div className="cta-text">
          <h2 id="cta-h" className="cta-title">{t.ctaTitle}</h2>
          <p className="cta-body">{t.ctaBody}</p>
          <a className="btn btn-cta btn-lg" href="#console">{t.heroCtaPrimary}<Icon name="arrow" size={18} /></a>
        </div>
        <CtaScene className="cta-scene" />
      </div>
    </section>
  );
}

export function SiteFooter({ t, ruleset }: { t: Dict; ruleset: string }) {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Logo title={t.appTitle} sub={t.brandTagline} size={40} inverse />
          <p className="footer-legal"><strong>{t.disclaimerLead}</strong> {t.footer}</p>
        </div>
        <div>
          <p className="footer-h">{t.footerBy}</p>
          <p className="footer-company">{COMPANY.name}</p>
          <p className="footer-links">
            <a href={COMPANY.site} target="_blank" rel="noopener noreferrer">{COMPANY.siteLabel}<span className="sr-only"> {t.opensNewTab}</span></a>
          </p>
        </div>
        <div>
          <p className="footer-h">{t.footerContact}</p>
          <p className="footer-links"><a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></p>
          <p className="footer-links"><a href={COMPANY.phoneHref}>{COMPANY.phone}</a></p>
        </div>
      </div>
      <div className="wrap footer-base">
        <p>&copy; {new Date().getFullYear()} {COMPANY.name}. {t.footerRights}</p>
        {ruleset && <p className="mono">{fmt(t.rulesetNote, { v: ruleset })}</p>}
      </div>
    </footer>
  );
}
