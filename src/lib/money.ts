import type { CurrencyCode, Money } from "@/core/domain";

/**
 * Every supported currency is stored with 2 decimal minor units, including
 * currencies whose ISO 4217 exponent is 0 (such as JPY) or 3 (such as BHD).
 * One scale keeps USD, GBP and EUR comparable without per-currency tables.
 */
const MINOR_DECIMALS = 2;
const RATE_DECIMALS = 8;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const NUMBER = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const MAGNITUDE = String.raw`billions?|millions?|thousands?|mio\.?|mrd\.?|bn|mm|k|m|b`;
const CURRENCY_TOKEN = String.raw`us\$|usd|eur|gbp|aud|cad|chf|jpy|cny|sek|nok|dkk|inr|sgd|hkd|nzd|pln|czk|huf|ron|brl|mxn|zar|krw|try|aed|sar|ils|qar|kwd|€|£|\$`;
const RANGE_SEPARATOR = String.raw`(?:-|–|—|\bto\b|\band\b)`;

const MULTIPLIERS: ReadonlyArray<{ pattern: RegExp; factor: bigint }> = [
  { pattern: /^(?:billions?|bn|b|mrd\.?)$/i, factor: BigInt(1_000_000_000) },
  { pattern: /^(?:millions?|mio\.?|mm|m)$/i, factor: BigInt(1_000_000) },
  { pattern: /^(?:thousands?|k)$/i, factor: BigInt(1_000) },
];

const WORD_CURRENCIES = new Set([
  "AED",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "KWD",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "QAR",
  "RON",
  "SAR",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);

function requireCurrency(currency: CurrencyCode): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  return code;
}

function optionalCurrency(currency: string | null | undefined): string | null {
  if (currency == null) return null;
  const code = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Half-up (away from zero) integer division for a non-negative numerator. */
function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) {
    throw new Error("Cannot divide by a non-positive denominator");
  }
  return (numerator + denominator / BigInt(2)) / denominator;
}

function multiplierFor(magnitude: string | undefined): bigint {
  if (!magnitude) return BigInt(1);
  const match = MULTIPLIERS.find((entry) => entry.pattern.test(magnitude));
  return match?.factor ?? BigInt(1);
}

function parseLocaleNumber(
  raw: string,
): { digits: string; scale: number } | null {
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  let normalised = raw;
  if (lastDot !== -1 && lastComma !== -1) {
    normalised =
      lastComma > lastDot
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (lastComma !== -1) {
    const groups = raw.split(",");
    const thousands = groups.slice(1).every((group) => group.length === 3);
    normalised = thousands ? raw.replace(/,/g, "") : raw.replace(",", ".");
  } else if (lastDot !== -1) {
    const groups = raw.split(".");
    const thousands =
      groups.length > 2 && groups.slice(1).every((group) => group.length === 3);
    if (thousands) normalised = raw.replace(/\./g, "");
  }

  const [whole = "0", fraction = ""] = normalised.split(".");
  if (!/^\d+$/.test(whole) || (fraction !== "" && !/^\d+$/.test(fraction))) {
    return null;
  }
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  return { digits, scale: fraction.length };
}

function toMinor(
  rawNumber: string,
  magnitude: string | undefined,
): number | null {
  const parsed = parseLocaleNumber(rawNumber);
  if (!parsed) return null;
  const numerator =
    BigInt(parsed.digits) *
    multiplierFor(magnitude) *
    BigInt(10) ** BigInt(MINOR_DECIMALS);
  const minor = divHalfUp(numerator, BigInt(10) ** BigInt(parsed.scale));
  if (minor > MAX_SAFE) return null;
  return Number(minor);
}

function matchHasMoneySignal(
  matchText: string,
  magnitude: string | undefined,
): boolean {
  return Boolean(magnitude) || new RegExp(CURRENCY_TOKEN, "i").test(matchText);
}

function lowerAmountMinor(text: string): number | null {
  const range = new RegExp(
    `(${NUMBER})\\s*(${MAGNITUDE})?(?![a-z])\\s*${RANGE_SEPARATOR}\\s*(?:[^\\d\\s]{0,8}\\s*)?(${NUMBER})\\s*(${MAGNITUDE})?(?![a-z])`,
    "gi",
  );
  for (const match of text.matchAll(range)) {
    const leftNumber = match[1];
    const rightNumber = match[3];
    const matched = match[0];
    if (!leftNumber || !rightNumber || !matched) continue;
    if (!matchHasMoneySignal(matched, match[2] ?? match[4])) continue;
    const left = toMinor(leftNumber, match[2] ?? match[4]);
    const right = toMinor(rightNumber, match[4] ?? match[2]);
    if (left == null) return right;
    if (right == null) return left;
    return Math.min(left, right);
  }

  const single = new RegExp(
    `(?:${CURRENCY_TOKEN}\\s*)?(${NUMBER})\\s*(${MAGNITUDE})?(?![a-z])(?:\\s*(?:${CURRENCY_TOKEN}))?`,
    "gi",
  );
  for (const match of text.matchAll(single)) {
    const rawNumber = match[1];
    const matched = match[0];
    if (!rawNumber || !matched) continue;
    if (!matchHasMoneySignal(matched, match[2])) continue;
    return toMinor(rawNumber, match[2]);
  }
  return null;
}

function detectCurrency(text: string, hint: string | null): string | null {
  if (/us\$|\busd\b/i.test(text)) return "USD";
  if (/€|\beur\b/i.test(text)) return "EUR";
  if (/£|\bgbp\b/i.test(text)) return "GBP";
  if (hint && new RegExp(`\\b${hint}\\b`, "i").test(text)) return hint;
  const words = text.match(/\b[A-Za-z]{3}\b/g) ?? [];
  for (const word of words) {
    const code = word.toUpperCase();
    if (WORD_CURRENCIES.has(code)) return code;
  }
  if (text.includes("$")) return hint ?? "USD";
  return hint;
}

/**
 * Parses a verbatim amount. A bare `$` is USD unless `currencyHint` is set.
 * Ranges use the lower value. Unparseable text returns null.
 */
export function parseAmountText(
  text: string | null | undefined,
  currencyHint?: string | null,
): Money | null {
  if (typeof text !== "string") return null;
  const normalised = text.replace(/\s+/g, " ").trim();
  if (!normalised) return null;
  const currency = detectCurrency(normalised, optionalCurrency(currencyHint));
  const amountMinor = lowerAmountMinor(normalised);
  if (!currency || amountMinor == null) return null;
  return { amountMinor, currency };
}

/**
 * Major units to integer minor units, rounded half-up.
 * Uses 2 decimal places for every supported currency.
 */
export function toMinorUnits(major: number, currency: CurrencyCode): number {
  requireCurrency(currency);
  if (!Number.isFinite(major)) {
    throw new Error("Amount must be a finite number");
  }
  const negative = major < 0;
  const [whole = "0", fraction = ""] = Math.abs(major).toFixed(4).split(".");
  const padded = fraction.padEnd(4, "0");
  let minor =
    BigInt(whole) * BigInt(100) + BigInt(padded.slice(0, MINOR_DECIMALS));
  const remainder = padded.slice(MINOR_DECIMALS);
  if (remainder >= "50") minor += BigInt(1);
  return Number(negative ? -minor : minor);
}

/**
 * Integer minor units back to major units.
 * Uses 2 decimal places for every supported currency, so this divides by 100.
 */
export function fromMinorUnits(
  amountMinor: number,
  currency: CurrencyCode,
): number {
  requireCurrency(currency);
  if (!Number.isInteger(amountMinor)) {
    throw new Error("amountMinor must be an integer");
  }
  return amountMinor / 100;
}

function ratePerEur(
  code: string,
  perEur: Readonly<Record<string, number>>,
): bigint {
  const rate = code === "EUR" ? (perEur[code] ?? 1) : perEur[code];
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Missing ECB rate for ${code}`);
  }
  const [whole = "0", fraction = ""] = rate.toFixed(RATE_DECIMALS).split(".");
  return BigInt(`${whole}${fraction.padEnd(RATE_DECIMALS, "0")}`);
}

/**
 * Converts minor units from one currency to another through EUR.
 * `perEur` maps each currency to units of that currency per 1 EUR.
 * The result is rounded half-up to minor units. EUR defaults to 1.
 */
export function convertMinor(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  perEur: Readonly<Record<string, number>>,
): number {
  if (!Number.isInteger(amountMinor)) {
    throw new Error("amountMinor must be an integer");
  }
  const fromCode = requireCurrency(from);
  const toCode = requireCurrency(to);
  if (fromCode === toCode) return amountMinor;
  const fromRate = ratePerEur(fromCode, perEur);
  const toRate = ratePerEur(toCode, perEur);
  const negative = amountMinor < 0;
  const converted = divHalfUp(BigInt(Math.abs(amountMinor)) * toRate, fromRate);
  if (converted > MAX_SAFE) {
    throw new Error("Converted amount exceeds the safe integer range");
  }
  return Number(negative ? -converted : converted);
}
