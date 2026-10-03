/** A post-login destination must stay on this origin, including browser URL normalization. */
export function safeNext(next: string | null): string {
  const hasControlOrSpace = next ? Array.from(next).some(character => { const code = character.charCodeAt(0); return code <= 32 || code === 127; }) : false;
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || hasControlOrSpace) return "/";
  try {
    const base = "https://axora.invalid";
    const destination = new URL(next, base);
    return destination.origin === base ? `${destination.pathname}${destination.search}${destination.hash}` : "/";
  } catch { return "/"; }
}
