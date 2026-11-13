/**
 * Spec-phase2 section 10.3. A participant is stored only if it is clearly an
 * organisation: its name ends in a company form, or it has a registration
 * number. Everything else may be a sole trader, that is a person (D19).
 */
const COMPANY_FORM =
  /(?:^|[\s,(])(?:l\.?t\.?d\.?|limited|p\.?l\.?c\.?|l\.?l\.?p\.?|c\.?i\.?c\.?|l\.?p\.?|community interest company)$/i;

export function isOrganisation(
  name: string,
  regNumber?: string | null,
): boolean {
  if (regNumber && regNumber.trim() !== "") return true;
  const trimmed = name.trim();
  const match = COMPANY_FORM.exec(trimmed);
  // Something must come before the company form ("Ltd" alone is not a name).
  return match !== null && trimmed.slice(0, match.index).trim() !== "";
}
