import outcodeData from "./uk-outcodes.json";
import { ukRegionByCode, type UkRegionCode } from "./uk-regions";

export interface UkPostcode {
  outcode: string;
  incode: string;
}

export interface OutcodeCentroid {
  lat: number;
  lon: number;
  itl1: UkRegionCode;
}

/**
 * Royal Mail's published format rules. The outward code is one or two
 * letters then a digit and an optional digit or letter. The inward code is a
 * digit and two letters that never use C, I, K, M, O or V.
 */
const POSTCODE_PATTERN =
  /^(GIR ?0AA|[A-PR-UWYZ](?:[0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRV-Y])) ?([0-9][ABD-HJLNP-UW-Z]{2})$/;

/** "L35 9JJ" gives `{ outcode: "L35", incode: "9JJ" }`. Invalid text gives null. */
export function parseUkPostcode(text: string): UkPostcode | null {
  const cleaned = text.trim().toUpperCase().replace(/\s+/g, " ");
  if (cleaned.length < 5 || cleaned.length > 8) return null;
  const match = POSTCODE_PATTERN.exec(cleaned);
  if (!match) return null;
  const compact = cleaned.replace(" ", "");
  // The incode is always the last three characters.
  return { outcode: compact.slice(0, -3), incode: compact.slice(-3) };
}

const OUTCODES = outcodeData as unknown as Readonly<
  Record<string, readonly [number, number, string]>
>;

/** The centroid and ITL1 code of a postcode district such as "L35", or null. */
export function outcodeCentroid(outcode: string): OutcodeCentroid | null {
  const entry = OUTCODES[outcode.trim().toUpperCase()];
  if (!entry) return null;
  const [lat, lon, itl1] = entry;
  const region = ukRegionByCode(itl1);
  if (!region) return null;
  return { lat, lon, itl1: region.code };
}

/**
 * The ITL1 code for an outcode. Northern Ireland districts ("BT1") have no
 * centroid, because their postcode data is not open, but the area is known.
 */
export function outcodeItl1(outcode: string): UkRegionCode | null {
  const clean = outcode.trim().toUpperCase();
  const centroid = outcodeCentroid(clean);
  if (centroid) return centroid.itl1;
  return /^BT[0-9]{1,2}$/.test(clean) ? "TLN" : null;
}
