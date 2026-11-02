import { BRAND_GLYPHS, BRAND_WORDMARK_WIDTH, FOLDED_T_PATHS } from "@/components/ui/brand-shapes";

/** Compact app icon; the full wordmark uses this T as its first letter. */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return <svg viewBox="0 0 128 128" className={className} aria-hidden>
    <rect width="128" height="128" rx="34" fill="#6948e8" />
    <g transform="translate(13 12) scale(.99)" fill="white">{FOLDED_T_PATHS.map((d) => <path key={d} d={d} />)}</g>
  </svg>;
}

export function BrandWordmark({ className = "h-10 w-auto" }: { className?: string }) {
  return <svg viewBox={`0 0 ${BRAND_WORDMARK_WIDTH} 102`} role="img" aria-label="Tableros" className={className}>
    <g><path d={FOLDED_T_PATHS[0]} fill="#7958ef" /><path d={FOLDED_T_PATHS[1]} fill="#5939c7" /><path d={FOLDED_T_PATHS[2]} fill="#b18aea" /></g>
    <g fill="currentColor" stroke="currentColor" strokeWidth="24" strokeLinejoin="round" paintOrder="stroke fill">{BRAND_GLYPHS.map((glyph, i) => <path key={i} d={glyph.d} transform={glyph.transform} />)}</g>
  </svg>;
}
