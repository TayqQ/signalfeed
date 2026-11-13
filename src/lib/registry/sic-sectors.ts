import type { Sector } from "@/core/sectors";
import { normaliseSicCode } from "./sic-codes";

// Maps UK SIC 2007 codes to the 16 sectors (spec-phase3 section 7.3, D57).
// A rule table for people to review: no model is involved.
//
// How it works:
//   1. A 5-digit exception wins, if there is one.
//   2. Otherwise the division (the first two digits) decides.
//   3. `null` means "no sector".
//
// "No sector" rule: a code maps to nothing when it says nothing about what
// the company makes or does. Holding companies, "other ... n.e.c." catch-alls,
// non-trading and dormant companies, private households and membership
// bodies all fall under it.
//
// Vague codes, no sector (the first six come from the spec):
//   70229 management consultancy other than financial management
//   74909 other professional, scientific and technical activities
//   82990 other business support service activities
//   96090 other service activities
//   99999 dormant company
//   98000 residents' property management
// Added by the same rule:
//   64201-64205, 64209 holding companies of every kind
//   70100 activities of head offices
//   74990 non-trading company
//   46180, 46190, 46760, 46900 agents and wholesalers of mixed or other goods
//   94990 other membership organisations
//   97000, 98100, 98200 private households
//   99000 extraterritorial organisations
//
// Judgement calls (a reviewer may reasonably disagree):
//   - Mining and quarrying: oil, gas and coal (05, 06, 09) go to
//     `climate-energy`; ores and stone (07, 08) go to `manufacturing-industrial`.
//   - Waste, water and sewerage (36-39) go to `climate-energy`.
//   - Forestry and fishing (02, 03) go to `food-agriculture`.
//   - Motor vehicle sales and repair (45) go to `transport-mobility`.
//   - Telecoms (61) goes to `software-ai`; satellite telecoms to `space-deep-tech`.
//   - Electronic components (26110, 26120) go to `space-deep-tech`.
//   - Other research on natural sciences and engineering (72190) goes to
//     `space-deep-tech`; social science research (72200) to `business-services`.
//   - Veterinary activities (75000) go to `health-life-sciences`.
//   - Gambling (92000) goes to `media-creative` ("Media, creative and gaming").
//   - Libraries, archives and museums (91) go to `public-social`.
//   - Wholesale (46) follows the goods sold; retail (47) is `retail-consumer`.
//   - Holding companies with a named industry (64201-64205) are still
//     "no sector": the industry is the group's, not the company's.
// `other` is never assigned from a SIC code.

/** Bump when any table below changes, so the sectors rebuild (061) runs. */
export const SIC_SECTOR_MAP_VERSION = "2026-11-12.1";

/** Division (first two digits) to sector. Every division in the list has an entry. */
export const SIC_DIVISION_SECTORS: Readonly<Record<string, Sector | null>> = {
  "01": "food-agriculture",
  "02": "food-agriculture",
  "03": "food-agriculture",
  "05": "climate-energy",
  "06": "climate-energy",
  "07": "manufacturing-industrial",
  "08": "manufacturing-industrial",
  "09": "climate-energy",
  "10": "food-agriculture",
  "11": "food-agriculture",
  "12": "retail-consumer",
  "13": "manufacturing-industrial",
  "14": "retail-consumer",
  "15": "retail-consumer",
  "16": "manufacturing-industrial",
  "17": "manufacturing-industrial",
  "18": "media-creative",
  "19": "climate-energy",
  "20": "manufacturing-industrial",
  "21": "health-life-sciences",
  "22": "manufacturing-industrial",
  "23": "manufacturing-industrial",
  "24": "manufacturing-industrial",
  "25": "manufacturing-industrial",
  "26": "manufacturing-industrial",
  "27": "manufacturing-industrial",
  "28": "manufacturing-industrial",
  "29": "transport-mobility",
  "30": "transport-mobility",
  "31": "retail-consumer",
  "32": "manufacturing-industrial",
  "33": "manufacturing-industrial",
  "35": "climate-energy",
  "36": "climate-energy",
  "37": "climate-energy",
  "38": "climate-energy",
  "39": "climate-energy",
  "41": "property-construction",
  "42": "property-construction",
  "43": "property-construction",
  "45": "transport-mobility",
  "46": "retail-consumer",
  "47": "retail-consumer",
  "49": "transport-mobility",
  "50": "transport-mobility",
  "51": "transport-mobility",
  "52": "transport-mobility",
  "53": "transport-mobility",
  "55": "retail-consumer",
  "56": "retail-consumer",
  "58": "media-creative",
  "59": "media-creative",
  "60": "media-creative",
  "61": "software-ai",
  "62": "software-ai",
  "63": "software-ai",
  "64": "financial-services",
  "65": "financial-services",
  "66": "financial-services",
  "68": "property-construction",
  "69": "business-services",
  "70": "business-services",
  "71": "business-services",
  "72": "business-services",
  "73": "media-creative",
  "74": "business-services",
  "75": "health-life-sciences",
  "77": "business-services",
  "78": "business-services",
  "79": "retail-consumer",
  "80": "security-defence",
  "81": "business-services",
  "82": "business-services",
  "84": "public-social",
  "85": "education",
  "86": "health-life-sciences",
  "87": "health-life-sciences",
  "88": "public-social",
  "90": "media-creative",
  "91": "public-social",
  "92": "media-creative",
  "93": "retail-consumer",
  "94": "public-social",
  "95": "retail-consumer",
  "96": "retail-consumer",
  "97": null,
  "98": null,
  "99": null,
};

/** 5-digit exceptions. They win over the division. */
export const SIC_CODE_EXCEPTIONS: Readonly<Record<string, Sector | null>> = {
  // Vague codes: no sector (see the comment at the top).
  "70229": null,
  "74909": null,
  "82990": null,
  "96090": null,
  "99999": null,
  "98000": null,
  "64201": null,
  "64202": null,
  "64203": null,
  "64204": null,
  "64205": null,
  "64209": null,
  "70100": null,
  "74990": null,
  "46180": null,
  "46190": null,
  "46760": null,
  "46900": null,
  "94990": null,
  "97000": null,
  "98100": null,
  "98200": null,
  "99000": null,

  // Mining
  "07210": "climate-energy", // uranium and thorium
  "09900": "manufacturing-industrial", // support for other mining

  // Manufacturing
  "20150": "food-agriculture", // fertilisers
  "20200": "food-agriculture", // pesticides and agrochemicals
  "20411": "retail-consumer", // soap and detergents
  "20412": "retail-consumer", // cleaning preparations
  "20420": "retail-consumer", // perfumes and toilet preparations
  "20510": "security-defence", // explosives
  "25400": "security-defence", // weapons and ammunition
  "26110": "space-deep-tech", // electronic components
  "26120": "space-deep-tech", // loaded electronic boards
  "26400": "retail-consumer", // consumer electronics
  "26520": "retail-consumer", // watches and clocks
  "26600": "health-life-sciences", // electromedical equipment
  "27200": "climate-energy", // batteries and accumulators
  "28301": "food-agriculture", // agricultural tractors
  "28302": "food-agriculture", // agricultural and forestry machinery
  "30120": "retail-consumer", // pleasure and sporting boats
  "30300": "space-deep-tech", // air and spacecraft
  "30400": "security-defence", // military fighting vehicles
  "32120": "retail-consumer", // jewellery
  "32130": "retail-consumer", // imitation jewellery
  "32200": "retail-consumer", // musical instruments
  "32300": "retail-consumer", // sports goods
  "32401": "retail-consumer", // professional and arcade games and toys
  "32409": "retail-consumer", // other games and toys
  "32500": "health-life-sciences", // medical and dental instruments
  "32910": "retail-consumer", // brooms and brushes
  "33150": "transport-mobility", // repair of ships and boats
  "33160": "transport-mobility", // repair of aircraft and spacecraft
  "33170": "transport-mobility", // repair of other transport equipment

  // Wholesale follows the goods sold
  "46110": "food-agriculture",
  "46120": "manufacturing-industrial",
  "46130": "property-construction",
  "46140": "manufacturing-industrial",
  "46170": "food-agriculture",
  "46210": "food-agriculture",
  "46220": "food-agriculture",
  "46230": "food-agriculture",
  "46310": "food-agriculture",
  "46320": "food-agriculture",
  "46330": "food-agriculture",
  "46341": "food-agriculture",
  "46342": "food-agriculture",
  "46350": "food-agriculture",
  "46360": "food-agriculture",
  "46370": "food-agriculture",
  "46380": "food-agriculture",
  "46390": "food-agriculture",
  "46460": "health-life-sciences",
  "46610": "food-agriculture",
  "46620": "manufacturing-industrial",
  "46630": "manufacturing-industrial",
  "46640": "manufacturing-industrial",
  "46690": "manufacturing-industrial",
  "46711": "climate-energy",
  "46719": "climate-energy",
  "46720": "manufacturing-industrial",
  "46730": "property-construction",
  "46740": "property-construction",
  "46750": "manufacturing-industrial",
  "46770": "climate-energy",

  // Retail
  "47730": "health-life-sciences", // dispensing chemists
  "47741": "health-life-sciences", // hearing aids
  "47749": "health-life-sciences", // medical and orthopaedic goods
  "47782": "health-life-sciences", // opticians

  // Transport
  "51220": "space-deep-tech", // space transport

  // Media and software
  "58290": "software-ai", // other software publishing
  "61300": "space-deep-tech", // satellite telecoms
  "62011": "media-creative", // leisure and entertainment software (games)
  "63910": "media-creative", // news agencies

  // Professional services
  "71111": "property-construction", // architecture
  "71112": "property-construction", // urban planning and landscape architecture
  "72110": "health-life-sciences", // biotechnology R&D
  "72190": "space-deep-tech", // other natural sciences and engineering R&D
  "74901": "climate-energy", // environmental consulting
  "74902": "property-construction", // quantity surveying

  // Rental and leasing
  "77110": "transport-mobility",
  "77120": "transport-mobility",
  "77210": "retail-consumer",
  "77220": "retail-consumer",
  "77299": "retail-consumer",
  "77310": "food-agriculture",
  "77320": "property-construction",
  "77341": "transport-mobility",
  "77342": "transport-mobility",
  "77351": "transport-mobility",
  "77352": "transport-mobility",

  // Security, public order, defence
  "80100": "security-defence",
  "80200": "security-defence",
  "80300": "security-defence",
  "84220": "security-defence", // defence activities
  "84240": "security-defence", // public order and safety
};

/**
 * The sectors for a company's SIC codes: sorted by slug, without repeats. Unknown or malformed codes and vague codes add nothing.
 */
export function sectorsForSic(codes: string[]): Sector[] {
  const found = new Set<Sector>();
  for (const raw of codes) {
    const code = normaliseSicCode(raw);
    if (code === null) continue;
    const sector = Object.hasOwn(SIC_CODE_EXCEPTIONS, code)
      ? SIC_CODE_EXCEPTIONS[code]
      : SIC_DIVISION_SECTORS[code.slice(0, 2)];
    if (sector) found.add(sector);
  }
  return [...found].sort();
}
