// Fixed sector list (docs/spec-phase2.md section 7.2, D45).
// Themes store these slugs and saved searches will too, so the list is
// append-only: never rename, reorder or remove a slug. Labels may be reworded.

export const SECTORS = [
  "software-ai",
  "financial-services",
  "health-life-sciences",
  "climate-energy",
  "transport-mobility",
  "property-construction",
  "retail-consumer",
  "food-agriculture",
  "manufacturing-industrial",
  "media-creative",
  "education",
  "business-services",
  "security-defence",
  "space-deep-tech",
  "public-social",
  "other",
] as const;
export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABELS: Readonly<Record<Sector, string>> = {
  "software-ai": "Software, AI and data",
  "financial-services": "Financial services",
  "health-life-sciences": "Health and life sciences",
  "climate-energy": "Climate and energy",
  "transport-mobility": "Transport and mobility",
  "property-construction": "Property and construction",
  "retail-consumer": "Retail and consumer",
  "food-agriculture": "Food and agriculture",
  "manufacturing-industrial": "Manufacturing and industrial",
  "media-creative": "Media, creative and gaming",
  education: "Education",
  "business-services": "Professional and business services",
  "security-defence": "Security and defence",
  "space-deep-tech": "Space and deep tech",
  "public-social": "Public sector and social impact",
  other: "Other",
};

const SECTOR_SET: ReadonlySet<string> = new Set(SECTORS);

export function isSector(value: unknown): value is Sector {
  return typeof value === "string" && SECTOR_SET.has(value);
}
