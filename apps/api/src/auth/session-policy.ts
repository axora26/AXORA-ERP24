export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const PORTAL_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export function nextSessionExpiry(createdAt: Date, now: number, maximumAge = SESSION_MAX_AGE_MS): Date {
  return new Date(Math.min(now + SESSION_IDLE_MS, createdAt.getTime() + maximumAge));
}
