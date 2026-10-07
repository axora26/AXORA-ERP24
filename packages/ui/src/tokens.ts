/**
 * @axora24/ui — Design tokens AXORA-ERP24.
 * Reference : docs/foundation/04-ux-design-system.md.
 *
 * Charte imposee (regle globale AXORA) : #1E3A8A, #2563EB, #111827, #BFC3C9,
 * #FFFFFF, polices Montserrat (titres) + Inter (corps de texte).
 */

export const colorTokens = {
  brand: {
    950: "#0A1B34",
    900: "#1E3A8A",
    700: "#1E4FBF",
    600: "#2563EB",
    100: "#EAF1FF",
  },
  ink: {
    900: "#111827",
    700: "#344054",
    600: "#475467",
    500: "#667085",
  },
  neutral: {
    900: "#111827",
    800: "#1B2535",
    500: "#667085",
    300: "#BFC3C9",
    200: "#E4E7EC",
    100: "#F2F4F7",
    50: "#F8FAFC",
    0: "#FFFFFF",
  },
  semantic: {
    success: "#067647",
    successSurface: "#E9F8F0",
    warning: "#B54708",
    warningSurface: "#FFF7E8",
    danger: "#B42318",
    dangerSurface: "#FEF3F2",
    info: "#1849A9",
    infoSurface: "#EAF1FF",
  },
} as const;

export const fontTokens = {
  heading: "Montserrat, sans-serif",
  body: "Inter, sans-serif",
} as const;

export const spacingScaleRem = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;

export const radiusTokens = {
  control: "0.5rem",
  panel: "0.75rem",
  shell: "1rem",
  pill: "999px",
} as const;

export const shadowTokens = {
  panel: "0 8px 24px rgba(15, 34, 70, 0.06)",
  floating: "0 18px 48px rgba(7, 18, 36, 0.18)",
} as const;

export const motionTokens = {
  quick: "120ms",
  standard: "180ms",
  deliberate: "240ms",
  easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

export const typographyTokens = {
  metadataMin: "0.75rem",
  body: "0.875rem",
  title: "clamp(1.625rem, 2vw, 2rem)",
} as const;

export type ColorTokens = typeof colorTokens;
export type FontTokens = typeof fontTokens;
export type RadiusTokens = typeof radiusTokens;
export type ShadowTokens = typeof shadowTokens;
export type MotionTokens = typeof motionTokens;
export type TypographyTokens = typeof typographyTokens;
