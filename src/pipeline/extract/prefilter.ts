// Broad on purpose: a miss here drops the item before the paid call.
// Patterns are case-insensitive and accept obvious inflections.

const FUNDING =
  /\b(?:rais(?:e|es|ed|ing)|fundrais(?:e|es|ed|ing)|funding|pre[-\s]?seeds?|seeds?|seed(?:ed|ing)|series[\s-]+[a-h]|rounds?|backed|invest(?:s|ed|ing|ment|ments)|secures|secured|closes|closed)\b/i;

const ACQUISITION =
  /\b(?:acquires?|acquired|acquiring|acquisitions?|buys|bought|mergers?)\b/i;

const LAUNCH =
  /\b(?:launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|show\s+hn|launch\s+hn)\b/i;

const AMOUNT = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const SCALE = String.raw`(?:billion|million|bn|k|m|b)`;
const CODE = String.raw`(?:usd|eur|gbp|cad|aud|chf|jpy|cny|inr|sek|nok|dkk|nzd|sgd|hkd)`;
const SYMBOL = String.raw`[$£€¥₹]`;

const MONEY = new RegExp(
  String.raw`(?:${SYMBOL}\s*${AMOUNT}\s*${SCALE}\b|\b${CODE}\s*${AMOUNT}\s*${SCALE}\b|\b${AMOUNT}\s*${SCALE}\s*${CODE}\b)`,
  "i",
);

const CANDIDATE_PATTERNS: readonly RegExp[] = [
  FUNDING,
  ACQUISITION,
  LAUNCH,
  MONEY,
];

export interface PrefilterInput {
  title: string;
  summary: string | null;
}

export function isCandidate({ title, summary }: PrefilterInput): boolean {
  const haystack = `${title}\n${summary ?? ""}`;
  return CANDIDATE_PATTERNS.some((pattern) => pattern.test(haystack));
}
