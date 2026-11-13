import sicData from "./sic-codes.json";

// The condensed UK SIC 2007 list used on the Companies House register
// (Open Government Licence v3.0; see scripts/registry/README.md).

const SIC_CODES: Readonly<Record<string, string>> = sicData;

/** Companies House sometimes drops the leading zero of a code. */
export function normaliseSicCode(code: string): string | null {
  const trimmed = code.trim();
  if (!/^\d{4,5}$/.test(trimmed)) return null;
  return trimmed.padStart(5, "0");
}

/** The description of a SIC code, or null when it is not in the list. */
export function sicLabel(code: string): string | null {
  const normal = normaliseSicCode(code);
  if (normal === null) return null;
  return Object.hasOwn(SIC_CODES, normal) ? (SIC_CODES[normal] ?? null) : null;
}

export function isKnownSic(code: string): boolean {
  return sicLabel(code) !== null;
}

/** Every known code, for tests and tooling. */
export function allSicCodes(): string[] {
  return Object.keys(SIC_CODES).sort();
}
