/**
 * @axora24/ui — Design tokens AXORA-ERP24.
 * Reference : docs/foundation/04-ux-design-system.md.
 *
 * Charte imposee (regle globale AXORA) : #1E3A8A, #2563EB, #111827, #BFC3C9,
 * #FFFFFF, polices Montserrat (titres) + Inter (corps de texte).
 */

export const colorTokens = {
  brand: {
    900: "#1E3A8A",
    600: "#2563EB",
  },
  ink: {
    900: "#111827",
  },
  neutral: {
    300: "#BFC3C9",
    0: "#FFFFFF",
  },
} as const;

export const fontTokens = {
  heading: "Montserrat, sans-serif",
  body: "Inter, sans-serif",
} as const;

export const spacingScaleRem = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;

export type ColorTokens = typeof colorTokens;
export type FontTokens = typeof fontTokens;
