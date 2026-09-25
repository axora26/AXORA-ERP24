/**
 * Formatage d'affichage. La conversion en nombre n'intervient QUE pour
 * l'affichage final : tous les calculs sont faits cote serveur en Decimal.
 */

const GROUP_SEPARATOR = "\u202f";

/** Incremente d'une unite un entier positif represente en chaine de chiffres. */
function incrementDigits(digits: string): string {
  const chars = digits.split("");
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] === "9") {
      chars[index] = "0";
    } else {
      chars[index] = String(Number(chars[index]) + 1);
      return chars.join("");
    }
  }
  return `1${chars.join("")}`;
}

/**
 * Formate une chaine decimale EXACTE (arrondi au plus proche, demi vers le
 * haut) sans jamais passer par un nombre flottant : aucune perte de
 * precision, meme au-dela de 2^53.
 */
export function formatDecimal(value: string, fractionDigits: number): string {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const negative = match[1] === "-";
  let integer = match[2] ?? "0";
  let fraction = match[3] ?? "";

  if (fraction.length > fractionDigits) {
    const roundUp = Number(fraction[fractionDigits]) >= 5;
    let kept = integer + fraction.slice(0, fractionDigits);
    if (roundUp) kept = incrementDigits(kept);
    integer = kept.slice(0, kept.length - fractionDigits) || "0";
    fraction = kept.slice(kept.length - fractionDigits);
  } else {
    fraction = fraction.padEnd(fractionDigits, "0");
  }

  integer = integer.replace(/^0+(?=\d)/, "");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  const isZero = /^0*$/.test(integer + fraction);
  const sign = negative && !isZero ? "-" : "";
  return fractionDigits > 0 ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;
}

export function formatMoney(amount: string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const formatted = formatDecimal(amount, 2);
  if (!currency) return formatted;
  return currency === "MIXED" ? `${formatted} (devises mixtes)` : `${formatted} ${currency}`;
}

/**
 * Montant abrege pour les indicateurs (ex. 5,99 M USD) ; la valeur exacte
 * reste disponible en infobulle via formatMoney.
 */
export function formatCompactMoney(amount: string, currency?: string | null): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return formatMoney(amount, currency);
  const sign = match[1] ?? "";
  const integer = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = match[3] ?? "";
  let formatted: string;
  if (integer.length > 6) {
    const shifted = `${integer.slice(0, integer.length - 6)}.${integer.slice(integer.length - 6)}${fraction}`;
    formatted = `${formatDecimal(`${sign}${shifted}`, 2)} M`;
  } else if (integer.length > 4) {
    const shifted = `${integer.slice(0, integer.length - 3)}.${integer.slice(integer.length - 3)}${fraction}`;
    formatted = `${formatDecimal(`${sign}${shifted}`, 1)} k`;
  } else {
    formatted = formatDecimal(amount, 2);
  }
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Somme exacte de montants decimaux (au centime) par entiers BigInt :
 * aucune erreur d'arrondi flottant. Les decimales au-dela du centime sont
 * tronquees (les montants API sont deja a 2 decimales).
 */
export function sumMoney(values: string[]): string {
  let total = 0n;
  for (const value of values) {
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) continue;
    const cents = BigInt(match[2] ?? "0") * 100n + BigInt(`${match[3] ?? ""}00`.slice(0, 2));
    total += match[1] ? -cents : cents;
  }
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function formatQuantity(value: string | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatDecimal(value, digits);
}

export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return `${formatDecimal(String(value), 1)} %`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Date du jour au format ISO court (YYYY-MM-DD) pour les champs date. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
