// Generic tags that say nothing about what a company does. They are never
// themed (spec-phase2 section 7.1). Only generic words: no company or place names.

export const GENERIC_TAG_SLUGS: ReadonlySet<string> = new Set([
  "startup",
  "startups",
  "technology",
  "tech",
  "innovation",
  "platform",
  "funding",
  "investment",
  "company",
  "business",
  "app",
  "solutions",
]);

/** True for a tag slug that must not be assigned to a theme. */
export function isGenericTag(slug: string): boolean {
  return GENERIC_TAG_SLUGS.has(slug.trim().toLowerCase());
}
