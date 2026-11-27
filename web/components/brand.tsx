// Brand identity: the Buyer Co-Pilot mark and lockups.
//
// Mark concept: a shield (protection) holding a house (the purchase) whose doorway is a
// check (your approval). It reads at 16px because it is built from three solid shapes, and
// every colour is a CSS variable so the same SVG works on light, dark and the navy splash.

import type { CSSProperties } from "react";

export const COMPANY = {
  name: "RYDETECH GLOBAL ENTERPRISE",
  site: "https://rydetechglobal.com",
  siteLabel: "rydetechglobal.com",
  email: "rydetechwizsolutions@proton.me",
  phone: "+0107697120",
  phoneHref: "tel:+0107697120",
} as const;

export function LogoMark({ size = 36, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 48 48" fill="none"
         aria-hidden="true" focusable="false">
      {/* Shield body */}
      <path d="M24 2.5l17.5 6.8v14.2c0 10.7-7.2 18.9-17.5 22-10.3-3.1-17.5-11.3-17.5-22V9.3L24 2.5z"
            fill="var(--logo-shield)" />
      {/* Inner rim: gives the mark depth without gradients (gradients break when ids collide across instances) */}
      <path d="M24 5.6l14.6 5.7v12.2c0 9.2-6 16.3-14.6 19.1-8.6-2.8-14.6-9.9-14.6-19.1V11.3L24 5.6z"
            stroke="var(--logo-rim)" strokeWidth="1.1" />
      {/* House */}
      <path d="M24 12.2l10.4 8.6V34H13.6V20.8L24 12.2z" fill="var(--logo-house)" />
      {/* Approval check, cut into the doorway */}
      <path className="logo-check" pathLength={1} d="M18.8 26l3.8 3.8 6.6-7.6" stroke="var(--logo-check)" strokeWidth="2.7"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark + wordmark. The wordmark is real text (selectable, translatable, readable by AT). */
export function Logo({ title, sub, size = 36, inverse = false }: {
  title: string; sub?: string; size?: number; inverse?: boolean;
}) {
  return (
    <span className={`logo${inverse ? " logo-inverse" : ""}`}>
      <LogoMark size={size} />
      <span className="logo-text">
        <span className="logo-name">{title}</span>
        {sub && <span className="logo-sub">{sub}</span>}
      </span>
    </span>
  );
}
