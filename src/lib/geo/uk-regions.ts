/** ITL1 areas, January 2025 (spec-phase2 section 9.1). */
export const UK_REGIONS = [
  { slug: "north-east", code: "TLC", name: "North East" },
  { slug: "north-west", code: "TLD", name: "North West" },
  {
    slug: "yorkshire-and-the-humber",
    code: "TLE",
    name: "Yorkshire and The Humber",
  },
  { slug: "east-midlands", code: "TLF", name: "East Midlands" },
  { slug: "west-midlands", code: "TLG", name: "West Midlands" },
  { slug: "east-of-england", code: "TLH", name: "East of England" },
  { slug: "london", code: "TLI", name: "London" },
  { slug: "south-east", code: "TLJ", name: "South East" },
  { slug: "south-west", code: "TLK", name: "South West" },
  { slug: "wales", code: "TLL", name: "Wales" },
  { slug: "scotland", code: "TLM", name: "Scotland" },
  { slug: "northern-ireland", code: "TLN", name: "Northern Ireland" },
] as const;

export type UkRegion = (typeof UK_REGIONS)[number];
export type UkRegionSlug = UkRegion["slug"];
export type UkRegionCode = UkRegion["code"];

const BY_SLUG: ReadonlyMap<string, UkRegion> = new Map(
  UK_REGIONS.map((region) => [region.slug, region]),
);
const BY_CODE: ReadonlyMap<string, UkRegion> = new Map(
  UK_REGIONS.map((region) => [region.code, region]),
);

/**
 * Other names that sources use for an area: Ordnance Survey ("Eastern"), the
 * ONS ITL1 file ("East (England)") and GtR spellings.
 */
const GTR_ALIASES: Readonly<Record<string, UkRegionSlug>> = {
  eastern: "east-of-england",
  east: "east-of-england",
  "east england": "east-of-england",
  "yorkshire and the humber": "yorkshire-and-the-humber",
  "yorkshire and humber": "yorkshire-and-the-humber",
  "north east england": "north-east",
  "north west england": "north-west",
  "east midlands england": "east-midlands",
  "west midlands england": "west-midlands",
  "south east england": "south-east",
  "south west england": "south-west",
};

export function ukRegionBySlug(slug: string): UkRegion | null {
  return BY_SLUG.get(slug) ?? null;
}

export function ukRegionByCode(code: string): UkRegion | null {
  return BY_CODE.get(code) ?? null;
}

function foldRegionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Maps a Gateway to Research or Ordnance Survey region name ("North West",
 * "Eastern") to an ITL1 area. Unknown names give null.
 */
export function ukRegionFromGtrName(name: string): UkRegion | null {
  const folded = foldRegionName(name);
  const alias = GTR_ALIASES[folded];
  if (alias) return BY_SLUG.get(alias) ?? null;
  return (
    UK_REGIONS.find((region) => foldRegionName(region.name) === folded) ?? null
  );
}
