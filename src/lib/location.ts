const COUNTRY_NAMES = new Intl.DisplayNames(["en-GB"], { type: "region" });

/** "London, United Kingdom", or null when nothing is known. */
export function formatLocation(
  city: string | null,
  countryCode: string | null,
): string | null {
  let country: string | null = null;
  if (countryCode) {
    try {
      country = COUNTRY_NAMES.of(countryCode) ?? countryCode;
    } catch {
      country = countryCode;
    }
  }
  const parts = [city, country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}
