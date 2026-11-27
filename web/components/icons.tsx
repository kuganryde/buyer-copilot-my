// Inline SVG icon set. Replaces the unicode text glyphs used previously, which render
// inconsistently across platforms and read as placeholder UI. Icons are decorative by default:
// meaning is always carried by adjacent text (WCAG 1.4.1), so they are aria-hidden.
// Inline (not an icon font / CDN) so the strict CSP (default-src 'self') is never loosened.

import type { SVGProps } from "react";

const PATHS = {
  shield: "M12 3l7.5 3v5.2c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V6L12 3z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  alert: "M12 4.2l9 15.6H3L12 4.2zM12 10v4.2M12 17.4v.1",
  info: "M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM12 11v5.2M12 7.9v.1",
  calc: "M6.5 3.5h11a1.5 1.5 0 011.5 1.5v14a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 19V5a1.5 1.5 0 011.5-1.5zM8.5 7.5h7M8.5 12h2M13.5 12h2M8.5 16h2M13.5 16h2",
  doc: "M7 3.5h7l5 5V20a.5.5 0 01-.5.5h-11A.5.5 0 017 20V3.5zM14 3.5v5h5M10 13h6M10 16.5h6",
  landmark: "M3.5 9.5L12 4l8.5 5.5M5.5 10v8M9.8 10v8M14.2 10v8M18.5 10v8M3.5 20.5h17",
  lock: "M6.5 11h11a1 1 0 011 1v7.5a1 1 0 01-1 1h-11a1 1 0 01-1-1V12a1 1 0 011-1zM8.5 11V8a3.5 3.5 0 017 0v3",
  key: "M8 11.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM10.5 13.5L19 5M16 8l2.5 2.5M13.5 10.5l1.8 1.8",
  arrow: "M5 12h14M13 6l6 6-6 6",
  external: "M14 4.5h5.5V10M19.5 4.5L11 13M17.5 14v4.5a1 1 0 01-1 1h-10a1 1 0 01-1-1v-10a1 1 0 011-1H11",
  refresh: "M19.5 11a7.5 7.5 0 00-13.4-3.6L4.5 9M4.5 4.5V9H9M4.5 13a7.5 7.5 0 0013.4 3.6l1.6-1.6M19.5 19.5V15H15",
  seal: "M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM8.3 12.3l2.5 2.5 4.9-5.2",
  home: "M4 11l8-7 8 7M6 9.8V20h12V9.8M10 20v-5.2h4V20",
  clip: "M19.5 11.5l-7.7 7.7a4.6 4.6 0 01-6.5-6.5l8-8a3.1 3.1 0 014.4 4.4l-8 8a1.5 1.5 0 01-2.2-2.2l7.3-7.3",
  chevron: "M6 9l6 6 6-6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, strokeWidth = 1.75, ...rest }: {
  name: IconName; size?: number; strokeWidth?: number;
} & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
