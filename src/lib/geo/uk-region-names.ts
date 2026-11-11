import { normalisePlaceName } from "./uk-places";
import type { UkRegionSlug } from "./uk-regions";

/**
 * Region, nation and county phrases. Each phrase must match the whole text.
 * Phrases that cover more than one ITL1 area ("the Midlands", "the North",
 * "the South", "the Home Counties") are left out on purpose, so they give null.
 */
const PHRASES: Readonly<Record<UkRegionSlug, readonly string[]>> = {
  "north-east": [
    "north east",
    "north east england",
    "north east of england",
    "northeast",
    "county durham",
    "durham",
    "northumberland",
    "tyne and wear",
    "tyneside",
    "teesside",
    "tees valley",
  ],
  "north-west": [
    "north west",
    "north west england",
    "north west of england",
    "northwest",
    "cumbria",
    "lancashire",
    "greater manchester",
    "merseyside",
    "cheshire",
  ],
  "yorkshire-and-the-humber": [
    "yorkshire",
    "yorkshire and the humber",
    "yorkshire and humber",
    "yorkshire and humberside",
    "humberside",
    "north yorkshire",
    "south yorkshire",
    "west yorkshire",
    "east yorkshire",
    "east riding of yorkshire",
  ],
  "east-midlands": [
    "east midlands",
    "derbyshire",
    "leicestershire",
    "lincolnshire",
    "northamptonshire",
    "nottinghamshire",
    "rutland",
  ],
  "west-midlands": [
    "west midlands",
    "west midlands region",
    "west midlands county",
    "herefordshire",
    "shropshire",
    "staffordshire",
    "warwickshire",
    "worcestershire",
  ],
  "east-of-england": [
    "east of england",
    "eastern england",
    "east anglia",
    "bedfordshire",
    "cambridgeshire",
    "essex",
    "hertfordshire",
    "norfolk",
    "suffolk",
  ],
  london: ["london", "greater london"],
  "south-east": [
    "south east",
    "south east england",
    "south east of england",
    "southeast",
    "berkshire",
    "buckinghamshire",
    "east sussex",
    "west sussex",
    "sussex",
    "hampshire",
    "isle of wight",
    "kent",
    "oxfordshire",
    "surrey",
  ],
  "south-west": [
    "south west",
    "south west england",
    "south west of england",
    "southwest",
    "west country",
    "cornwall",
    "devon",
    "dorset",
    "gloucestershire",
    "somerset",
    "wiltshire",
    "isles of scilly",
  ],
  wales: [
    "wales",
    "welsh",
    "north wales",
    "south wales",
    "mid wales",
    "west wales",
    "anglesey",
    "gwynedd",
    "powys",
    "clwyd",
    "dyfed",
    "gwent",
    "glamorgan",
    "cymru",
  ],
  scotland: [
    "scotland",
    "scottish",
    "scottish highlands",
    "highlands",
    "highlands and islands",
    "central scotland",
    "scottish borders",
    "lothian",
    "fife",
    "ayrshire",
    "lanarkshire",
    "aberdeenshire",
    "perthshire",
    "dumfries and galloway",
    "shetland",
    "orkney",
    "outer hebrides",
  ],
  "northern-ireland": [
    "northern ireland",
    "northern irish",
    "county antrim",
    "county armagh",
    "county down",
    "county fermanagh",
    "county londonderry",
    "county derry",
    "county tyrone",
    "antrim",
    "armagh",
    "fermanagh",
    "tyrone",
  ],
};

/** Trailing words that name the country, not the area ("Kent, UK"). */
const COUNTRY_SUFFIXES = new Set([
  "uk",
  "u k",
  "gb",
  "united kingdom",
  "great britain",
  "britain",
  "england",
]);

const PHRASE_TO_SLUG: ReadonlyMap<string, UkRegionSlug> = (() => {
  const index = new Map<string, UkRegionSlug>();
  for (const [slug, phrases] of Object.entries(PHRASES) as [
    UkRegionSlug,
    readonly string[],
  ][]) {
    for (const phrase of phrases) {
      const key = normalisePlaceName(phrase);
      const existing = index.get(key);
      if (existing && existing !== slug) {
        throw new Error(`Region phrase "${phrase}" is in two areas`);
      }
      index.set(key, slug);
    }
  }
  return index;
})();

function stripLeadingThe(key: string): string {
  return key.startsWith("the ") ? key.slice(4) : key;
}

/**
 * Maps a region, nation or county phrase to an ITL1 slug, or null.
 * "Scottish" gives `scotland` and "Kent" gives `south-east`. The whole text
 * must be a known phrase, never part of one, so "Kentish Town" gives null.
 * Ambiguous phrases such as "the Midlands" give null.
 */
export function ukRegionFromText(text: string): UkRegionSlug | null {
  const parts = text.split(",").map((part) => part.trim());
  while (parts.length > 1) {
    const last = parts[parts.length - 1] ?? "";
    if (!COUNTRY_SUFFIXES.has(normalisePlaceName(last))) break;
    parts.pop();
  }
  if (parts.length !== 1) return null;
  const key = stripLeadingThe(normalisePlaceName(parts[0] ?? ""));
  if (!key) return null;
  return PHRASE_TO_SLUG.get(key) ?? null;
}
