import type { CompanyLocationView } from "@/core/read-models";
import { ukRegionBySlug } from "@/lib/geo/uk-regions";
import { formatLocation } from "@/lib/location";

/**
 * "Leeds, Yorkshire and The Humber", "Scotland" for a region only, or
 * "Postcode district L35" for a grant. Falls back to the news city and
 * country, and to null when nothing is known.
 */
export function describeCompanyLocation(
  location: CompanyLocationView | null | undefined,
  fallback: { city: string | null; countryCode: string | null },
): string | null {
  if (location) {
    const region = location.ukRegion
      ? (ukRegionBySlug(location.ukRegion)?.name ?? null)
      : null;
    if (location.placeName) {
      return region ? `${location.placeName}, ${region}` : location.placeName;
    }
    if (location.outcode) return `Postcode district ${location.outcode}`;
    if (region) return region;
  }
  return formatLocation(fallback.city, fallback.countryCode);
}
