/**
 * PREMON brand glyph — a foresight "eye": the firewall sees the transaction
 * before you sign it. Renders in Monad purple (#836EF9) by default; pass `mono`
 * to inherit `currentColor` (for tinted contexts).
 */

import type { SVGProps } from "react";

export interface MarkProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  /** Render single-color using currentColor instead of Monad purple. */
  mono?: boolean;
}

export function Mark({ size = 24, mono = false, ...rest }: MarkProps) {
  const c = mono ? "currentColor" : "#836EF9";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="PREMON"
      {...rest}
    >
      <path
        d="M2 12c2.4-3.7 5.6-5.5 10-5.5S19.6 8.3 22 12c-2.4 3.7-5.6 5.5-10 5.5S4.4 15.7 2 12Z"
        stroke={c}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill={c} />
    </svg>
  );
}
