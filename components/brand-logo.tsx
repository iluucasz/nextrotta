/**
 * NextRotta wordmark: geometric "NEXT" with "ROTTA" spread underneath it. Drawn as SVG so it stays
 * crisp at any size; it follows the text color (currentColor), and "ROTTA" takes the accent color.
 * One stroke of the X fades out — the brand's signature detail.
 */

type LogoProps = {
  className?: string;
  /** Color of "ROTTA" (and the fading stroke). Defaults to the brand green. */
  accent?: string;
  title?: string;
};

const BRAND_GREEN = '#1f9d74';

export function BrandLogo({ className, accent = BRAND_GREEN, title = 'NextRotta' }: LogoProps) {
  return (
    <svg viewBox="0 0 134 62" className={className} role="img" aria-label={title} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <defs>
        <linearGradient id="nextrotta-logo-fade" x1="92" y1="0" x2="72" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={accent} />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* N */}
      <rect x="0" y="0" width="7" height="40" />
      <rect x="23" y="0" width="7" height="40" />
      <polygon points="0,0 7.5,0 30,40 22.5,40" />
      {/* E */}
      <rect x="37" y="0" width="7" height="40" />
      <rect x="37" y="0" width="23" height="7" />
      <rect x="37" y="16.5" width="20" height="7" />
      <rect x="37" y="33" width="23" height="7" />
      {/* X: one solid stroke, one fading */}
      <polygon points="66,0 74.5,0 98,40 89.5,40" />
      <polygon points="89.5,0 98,0 74.5,40 66,40" fill="url(#nextrotta-logo-fade)" />
      {/* T */}
      <rect x="103" y="0" width="31" height="7" />
      <rect x="115" y="0" width="7" height="40" />
      {/* ROTTA, spread to the width of NEXT */}
      <text
        x="0"
        y="61"
        textLength="134"
        lengthAdjust="spacing"
        fill={accent}
        style={{ font: '700 15.5px var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif)' }}
      >
        ROTTA
      </text>
    </svg>
  );
}

/** Square mark for tight spots (collapsed menu, favicon): the N with the fading diagonal. */
export function BrandMark({ className, accent = BRAND_GREEN, title = 'NextRotta' }: LogoProps) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <defs>
        <linearGradient id="nextrotta-mark-fade" x1="10" y1="9" x2="30" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill={accent} />
      <rect x="10" y="9" width="5" height="22" fill="#fff" />
      <rect x="25" y="9" width="5" height="22" fill="#fff" />
      <polygon points="10,9 15.5,9 30,31 24.5,31" fill="url(#nextrotta-mark-fade)" />
    </svg>
  );
}
