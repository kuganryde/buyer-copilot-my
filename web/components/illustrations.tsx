// Original editorial illustrations. Why drawn SVG instead of photos:
//  * CSP is img-src 'self' data:, so hot-linked stock photos would be blocked (and loosening a security
//    header for decoration is the wrong trade).
//  * Photos of "a real house" in a property-law tool imply a real listing, a real seller or a real outcome.
//    A neutral drawing of a Malaysian terrace row can't mislead.
//  * Inline SVG is a few KB, has no licence to track, scales crisply and follows the light/dark theme
//    through the same CSS variables as the rest of the UI.
// All are decorative: aria-hidden, not focusable, and meaning is always carried by adjacent text.

import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = { "aria-hidden": true, focusable: "false", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" };

/** A row of terrace houses (rumah teres) with the middle one "approved". Sits under the hero copy. */
export function HeroScene({ className }: { className?: string }) {
  const house = (x: number, tone: "var(--surface)" | "var(--surface-2)", door: string, key: string) => (
    <g key={key}>
      {/* Roof, eaves and body */}
      <path d={`M${x - 6} 74 L${x + 75} 34 L${x + 156} 74 Z`} fill="var(--art-roof)" stroke="var(--ink)" strokeWidth="2" />
      <rect x={x} y="74" width="150" height="116" fill={tone} stroke="var(--ink)" strokeWidth="2" />
      {/* Upper window with mullions */}
      <rect x={x + 50} y="90" width="50" height="38" rx="2" fill="var(--bg)" stroke="var(--ink)" strokeWidth="2" />
      <path d={`M${x + 75} 90 V128 M${x + 50} 109 H${x + 100}`} stroke="var(--ink)" strokeWidth="1.5" />
      {/* Door */}
      <rect x={x + 18} y="140" width="34" height="50" rx="2" fill={door} stroke="var(--ink)" strokeWidth="2" />
      <circle cx={x + 46} cy="166" r="2.2" fill="var(--ink)" />
      {/* Front gate and grille */}
      <path d={`M${x + 64} 190 V158 H${x + 140} V190`} stroke="var(--ink)" strokeWidth="2" />
      <path d={`M${x + 76} 158 V190 M${x + 88} 158 V190 M${x + 100} 158 V190 M${x + 112} 158 V190 M${x + 124} 158 V190`} stroke="var(--ink)" strokeWidth="1.2" opacity="0.55" />
    </g>
  );
  return (
    <svg {...base} className={className} viewBox="0 0 560 220" width="560" height="220">
      {/* Sun and distant tree */}
      <circle cx="486" cy="52" r="20" fill="var(--brass)" opacity="0.9" />
      <path d="M522 190 V150" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="522" cy="134" r="22" fill="var(--accent)" opacity="0.22" stroke="var(--accent)" strokeWidth="2" />
      {/* Houses: the middle one is highlighted */}
      {house(20, "var(--surface)", "var(--surface-2)", "a")}
      {house(175, "var(--surface-2)", "var(--accent)", "b")}
      {house(330, "var(--surface)", "var(--surface-2)", "c")}
      {/* Approval badge above the chosen house */}
      <circle cx="250" cy="16" r="13" fill="var(--accent)" />
      <path d="M243.5 16.5l4.5 4.5 8.5-9" stroke="var(--accent-ink)" strokeWidth="2.6" />
      {/* Ground and kerb */}
      <path d="M0 190 H560" stroke="var(--ink)" strokeWidth="2" />
      <path d="M0 200 H560" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="2 10" />
    </svg>
  );
}

/** A title document with a seal and a key. Sits beside the pinned "five steps" heading. */
export function DocumentScene({ className }: { className?: string }) {
  return (
    <svg {...base} className={className} viewBox="0 0 320 260" width="320" height="260">
      {/* Sheet behind */}
      <g transform="rotate(7 155 135)">
        <rect x="74" y="30" width="170" height="210" rx="12" fill="var(--surface-2)" stroke="var(--line-strong)" strokeWidth="2" />
      </g>
      {/* Front sheet */}
      <rect x="48" y="20" width="170" height="210" rx="12" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2" />
      <rect x="68" y="42" width="84" height="10" rx="4" fill="var(--ink)" />
      <path d="M68 70 H198 M68 86 H178 M68 102 H190" stroke="var(--line-strong)" strokeWidth="6" />
      {/* Small house glyph */}
      <path d="M72 150 L92 132 L112 150 M78 146 V170 H106 V146" stroke="var(--ink)" strokeWidth="2.2" />
      <path d="M126 140 H198 M126 156 H186 M126 172 H192" stroke="var(--line-strong)" strokeWidth="6" />
      {/* Seal */}
      <circle cx="176" cy="204" r="30" stroke="var(--brass)" strokeWidth="2" strokeDasharray="3 5" />
      <circle cx="176" cy="204" r="22" fill="var(--accent)" />
      <path d="M166 204.5l7 7 12-13" stroke="var(--accent-ink)" strokeWidth="3" />
      {/* Key */}
      <g stroke="var(--brass)" strokeWidth="3">
        <circle cx="262" cy="172" r="13" fill="var(--surface)" />
        <path d="M262 185 V236 M262 212 H274 M262 226 H272" />
      </g>
    </svg>
  );
}

/** A detached house with a key and approval check, drawn for the always-navy closing band. */
export function CtaScene({ className }: { className?: string }) {
  const line = "rgba(255,255,255,0.88)";
  return (
    <svg {...base} className={className} viewBox="0 0 360 240" width="360" height="240">
      <circle cx="292" cy="56" r="22" fill="#D4A95A" opacity="0.9" />
      {/* House */}
      <path d="M70 108 L170 44 L270 108 Z" fill="rgba(255,255,255,0.10)" stroke={line} strokeWidth="2.5" />
      <rect x="86" y="108" width="168" height="98" fill="rgba(255,255,255,0.06)" stroke={line} strokeWidth="2.5" />
      <rect x="150" y="146" width="40" height="60" rx="3" fill="#2DD4BF" stroke={line} strokeWidth="2.5" />
      <circle cx="182" cy="178" r="2.6" fill="#0B1B33" />
      <rect x="104" y="128" width="32" height="28" rx="2" stroke={line} strokeWidth="2" />
      <rect x="204" y="128" width="32" height="28" rx="2" stroke={line} strokeWidth="2" />
      {/* Approval badge on the gable */}
      <circle cx="170" cy="82" r="15" fill="#2DD4BF" />
      <path d="M162.5 82.5l5.5 5.5 10-10.5" stroke="#0B1B33" strokeWidth="3" />
      {/* Ground */}
      <path d="M30 206 H330" stroke={line} strokeWidth="2.5" />
      <path d="M30 218 H330" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeDasharray="2 10" />
      {/* Key */}
      <g stroke="#D4A95A" strokeWidth="3.2" transform="translate(286 150) rotate(-24)">
        <circle cx="0" cy="0" r="12" />
        <path d="M0 12 V50 M0 32 H12 M0 44 H10" />
      </g>
    </svg>
  );
}
