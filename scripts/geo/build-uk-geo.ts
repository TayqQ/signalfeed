/**
 * Builds src/lib/geo/uk-places.json and src/lib/geo/uk-outcodes.json from
 * open data. Run it by hand; tests never call it and nothing here uses the
 * network.
 *
 *   pnpm exec tsx scripts/geo/build-uk-geo.ts <downloads-dir> [out-dir]
 *
 * <downloads-dir> must sit outside the repository. See scripts/geo/README.md
 * for the folders it expects and the download steps.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format } from "prettier";
import { slugify } from "../../src/lib/normalise";
import {
  UK_REGIONS,
  ukRegionFromGtrName,
  type UkRegionCode,
} from "../../src/lib/geo/uk-regions";

// ---------------------------------------------------------------------------
// Coordinates: national grids to WGS84 (Helmert, about 5 m accuracy)
// ---------------------------------------------------------------------------

interface Ellipsoid {
  a: number;
  b: number;
}
interface Grid {
  ellipsoid: Ellipsoid;
  f0: number;
  lat0: number;
  lon0: number;
  n0: number;
  e0: number;
}
interface Helmert {
  tx: number;
  ty: number;
  tz: number;
  /** Scale change in parts per million. */
  s: number;
  /** Rotations in arc seconds (position vector convention). */
  rx: number;
  ry: number;
  rz: number;
}

const WGS84: Ellipsoid = { a: 6378137, b: 6356752.314245 };
const AIRY_1830: Ellipsoid = { a: 6377563.396, b: 6356256.909 };
const AIRY_MODIFIED: Ellipsoid = { a: 6377340.189, b: 6356034.447 };

const BRITISH_GRID: Grid = {
  ellipsoid: AIRY_1830,
  f0: 0.9996012717,
  lat0: 49,
  lon0: -2,
  n0: -100000,
  e0: 400000,
};
const IRISH_GRID: Grid = {
  ellipsoid: AIRY_MODIFIED,
  f0: 1.000035,
  lat0: 53.5,
  lon0: -8,
  n0: 250000,
  e0: 200000,
};

/** OSGB36 to WGS84, Ordnance Survey's published seven parameters. */
const OSGB36_TO_WGS84: Helmert = {
  tx: -446.448,
  ty: 125.157,
  tz: -542.06,
  s: 20.4894,
  rx: -0.1502,
  ry: -0.247,
  rz: -0.8421,
};
/** TM65 (Irish Grid datum) to WGS84, EPSG:1641 with signs for position vector. */
const TM65_TO_WGS84: Helmert = {
  tx: 482.5,
  ty: -130.6,
  tz: 564.6,
  s: -8.15,
  rx: 1.042,
  ry: 0.214,
  rz: 0.631,
};

const RAD = Math.PI / 180;
const ARC_SECOND = RAD / 3600;

function gridToLatLon(
  grid: Grid,
  easting: number,
  northing: number,
): { lat: number; lon: number } {
  const { a, b } = grid.ellipsoid;
  const { f0, n0, e0 } = grid;
  const lat0 = grid.lat0 * RAD;
  const lon0 = grid.lon0 * RAD;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n * n * n;

  let lat = lat0;
  let m = 0;
  do {
    lat = (northing - n0 - m) / (a * f0) + lat;
    const ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const mb =
      (3 * n + 3 * n2 + (21 / 8) * n3) *
      Math.sin(lat - lat0) *
      Math.cos(lat + lat0);
    const mc =
      ((15 / 8) * n2 + (15 / 8) * n3) *
      Math.sin(2 * (lat - lat0)) *
      Math.cos(2 * (lat + lat0));
    const md =
      (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    m = b * f0 * (ma - mb + mc - md);
  } while (Math.abs(northing - n0 - m) >= 0.00001);

  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const nu = (a * f0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * f0 * (1 - e2)) / Math.pow(1 - e2 * sin * sin, 1.5);
  const eta2 = nu / rho - 1;
  const tan = Math.tan(lat);
  const tan2 = tan * tan;
  const tan4 = tan2 * tan2;
  const tan6 = tan4 * tan2;
  const sec = 1 / cos;
  const nu3 = nu ** 3;
  const nu5 = nu ** 5;
  const nu7 = nu ** 7;

  const vii = tan / (2 * rho * nu);
  const viii =
    (tan / (24 * rho * nu3)) * (5 + 3 * tan2 + eta2 - 9 * tan2 * eta2);
  const ix = (tan / (720 * rho * nu5)) * (61 + 90 * tan2 + 45 * tan4);
  const x = sec / nu;
  const xi = (sec / (6 * nu3)) * (nu / rho + 2 * tan2);
  const xii = (sec / (120 * nu5)) * (5 + 28 * tan2 + 24 * tan4);
  const xiia =
    (sec / (5040 * nu7)) * (61 + 662 * tan2 + 1320 * tan4 + 720 * tan6);

  const de = easting - e0;
  const latOut = lat - vii * de ** 2 + viii * de ** 4 - ix * de ** 6;
  const lonOut = lon0 + x * de - xi * de ** 3 + xii * de ** 5 - xiia * de ** 7;
  return { lat: latOut, lon: lonOut };
}

function helmertToWgs84(
  from: Ellipsoid,
  params: Helmert,
  lat: number,
  lon: number,
): { lat: number; lon: number } {
  const e2 = 1 - (from.b * from.b) / (from.a * from.a);
  const sin = Math.sin(lat);
  const nu = from.a / Math.sqrt(1 - e2 * sin * sin);
  const x1 = nu * Math.cos(lat) * Math.cos(lon);
  const y1 = nu * Math.cos(lat) * Math.sin(lon);
  const z1 = nu * (1 - e2) * sin;

  const s = params.s / 1e6 + 1;
  const rx = params.rx * ARC_SECOND;
  const ry = params.ry * ARC_SECOND;
  const rz = params.rz * ARC_SECOND;
  const x2 = params.tx + x1 * s - y1 * rz + z1 * ry;
  const y2 = params.ty + x1 * rz + y1 * s - z1 * rx;
  const z2 = params.tz - x1 * ry + y1 * rx + z1 * s;

  const e2w = 1 - (WGS84.b * WGS84.b) / (WGS84.a * WGS84.a);
  const p = Math.hypot(x2, y2);
  let phi = Math.atan2(z2, p * (1 - e2w));
  for (let i = 0; i < 10; i += 1) {
    const sinPhi = Math.sin(phi);
    const nuW = WGS84.a / Math.sqrt(1 - e2w * sinPhi * sinPhi);
    phi = Math.atan2(z2 + e2w * nuW * sinPhi, p);
  }
  return { lat: phi / RAD, lon: Math.atan2(y2, x2) / RAD };
}

export function britishGridToWgs84(
  easting: number,
  northing: number,
): { lat: number; lon: number } {
  const g = gridToLatLon(BRITISH_GRID, easting, northing);
  return helmertToWgs84(AIRY_1830, OSGB36_TO_WGS84, g.lat, g.lon);
}

export function irishGridToWgs84(
  easting: number,
  northing: number,
): { lat: number; lon: number } {
  const g = gridToLatLon(IRISH_GRID, easting, northing);
  return helmertToWgs84(AIRY_MODIFIED, TM65_TO_WGS84, g.lat, g.lon);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Splits one CSV line. Handles quoted fields and doubled quotes. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function* csvRows(file: string): Generator<string[]> {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) yield parseCsvLine(line);
  }
}

function csvFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort()
    .map((name) => path.join(dir, name));
}

// ---------------------------------------------------------------------------
// Population bands
// ---------------------------------------------------------------------------

/** Average residents for each postcode unit across Great Britain (about 67M / 1.7M). */
const RESIDENTS_PER_POSTCODE_UNIT = 39;
/** Average residents for each occupied household, Northern Ireland census 2011. */
const RESIDENTS_PER_HOUSEHOLD = 2.4;

/** 1: under 10k, 2: 10k, 3: 25k, 4: 100k, 5: 250k, 6: 1M and over. */
export function populationBand(residents: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (residents >= 1_000_000) return 6;
  if (residents >= 250_000) return 5;
  if (residents >= 100_000) return 4;
  if (residents >= 25_000) return 3;
  if (residents >= 10_000) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Open Names
// ---------------------------------------------------------------------------

interface RawPlace {
  uri: string;
  name: string;
  aliases: string[];
  localType: "City" | "Town";
  itl1: UkRegionCode;
  lat: number;
  lon: number;
  /** The county or council area, in English, used to make slugs unique. */
  county: string;
  district: string;
  country: string;
  residents: number | null;
}

function itl1CodeFor(region: string, country: string): UkRegionCode | null {
  if (country === "Scotland") return "TLM";
  if (country === "Wales") return "TLL";
  if (country === "Northern Ireland") return "TLN";
  return ukRegionFromGtrName(region)?.code ?? null;
}

/** "Casnewydd - Newport" gives "Newport". */
function englishAdminName(value: string): string {
  const parts = value.split(" - ");
  return (parts[parts.length - 1] ?? value).trim();
}

function outcodeOf(postcode: string): string {
  const compact = postcode.replace(/\s+/g, "").toUpperCase();
  return compact.slice(0, -3);
}

/** Extra names people use. Keys are Open Names names. */
const EXTRA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  London: ["Greater London", "City of London", "Inner London", "Outer London"],
  "Kingston upon Hull": ["Hull"],
  "Newcastle upon Tyne": ["Newcastle"],
  "St Albans": ["Saint Albans"],
};

/** Places that Open Names lists as their own City but that count as part of another. */
const FOLDED_INTO: Readonly<Record<string, string>> = {
  "City of London": "London",
};

function readOpenNames(dir: string): {
  places: RawPlace[];
  outcodeRegions: Map<string, Map<UkRegionCode, number>>;
} {
  const header = readFileSync(
    path.join(dir, "Doc", "OS_Open_Names_Header.csv"),
    "utf8",
  )
    .replace(/^﻿/, "")
    .trim()
    .split(",");
  const col = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`Open Names column missing: ${name}`);
    return index;
  };
  const cName1 = col("NAME1");
  const cLang1 = col("NAME1_LANG");
  const cName2 = col("NAME2");
  const cLang2 = col("NAME2_LANG");
  const cLocal = col("LOCAL_TYPE");
  const cX = col("GEOMETRY_X");
  const cY = col("GEOMETRY_Y");
  const cUri = col("NAMES_URI");
  const cPopulated = col("POPULATED_PLACE_URI");
  const cDistrict = col("DISTRICT_BOROUGH");
  const cCounty = col("COUNTY_UNITARY");
  const cRegion = col("REGION");
  const cCountry = col("COUNTRY");

  const unitsByPlace = new Map<string, number>();
  const outcodeRegions = new Map<string, Map<UkRegionCode, number>>();
  const places: RawPlace[] = [];

  for (const file of csvFiles(path.join(dir, "Data"))) {
    for (const row of csvRows(file)) {
      const local = row[cLocal] ?? "";
      const country = row[cCountry] ?? "";
      if (local === "Postcode") {
        const populated = row[cPopulated] ?? "";
        if (populated) {
          unitsByPlace.set(populated, (unitsByPlace.get(populated) ?? 0) + 1);
        }
        const code = itl1CodeFor(row[cRegion] ?? "", country);
        const outcode = outcodeOf(row[cName1] ?? "");
        if (code && outcode) {
          const votes =
            outcodeRegions.get(outcode) ?? new Map<UkRegionCode, number>();
          votes.set(code, (votes.get(code) ?? 0) + 1);
          outcodeRegions.set(outcode, votes);
        }
        continue;
      }
      if (local !== "City" && local !== "Town") continue;

      const code = itl1CodeFor(row[cRegion] ?? "", country);
      if (!code) {
        throw new Error(`No ITL1 area for ${row[cName1]} (${row[cRegion]})`);
      }
      const name1 = row[cName1] ?? "";
      const name2 = row[cName2] ?? "";
      const lang1 = row[cLang1] ?? "";
      const lang2 = row[cLang2] ?? "";
      let name = name1;
      let other = name2;
      if (name2 && lang2 === "eng" && lang1 !== "eng") {
        name = name2;
        other = name1;
      }
      const { lat, lon } = britishGridToWgs84(Number(row[cX]), Number(row[cY]));
      places.push({
        uri: row[cUri] ?? "",
        name,
        aliases: other ? [other] : [],
        localType: local,
        itl1: code,
        lat,
        lon,
        county: englishAdminName(row[cCounty] ?? ""),
        district: englishAdminName(row[cDistrict] ?? ""),
        country,
        residents: null,
      });
    }
  }

  for (const place of places) {
    const units = unitsByPlace.get(place.uri) ?? 0;
    place.residents = units * RESIDENTS_PER_POSTCODE_UNIT;
  }
  return { places, outcodeRegions };
}

// ---------------------------------------------------------------------------
// Northern Ireland
// ---------------------------------------------------------------------------

interface NiFeature {
  properties: { Name: string; Band: string; OccHH_ex: number };
  geometry: { type: string; coordinates: number[][][][] | number[][][] };
}

const NI_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  "DERRY CITY": "Derry",
  "BELFAST CITY": "Belfast",
  "LISBURN CITY": "Lisburn",
  "OMAGH TOWN": "Omagh",
  "HILLSBOROUGH AND CULCAVY": "Hillsborough",
  "WARRENPOINT / BURREN": "Warrenpoint",
};
const NI_EXTRA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Derry: ["Londonderry"],
  Craigavon: ["Portadown", "Lurgan"],
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s'-])([a-z])/g,
      (_m, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
    );
}

function niDisplayName(raw: string): string {
  const override = NI_NAME_OVERRIDES[raw];
  if (override) return override;
  const cleaned = raw
    .replace(/\s*\(.*\)\s*/g, " ")
    .replace(/\s+including\s+.*$/i, "")
    .replace(/\s+URBAN AREA$/i, "")
    .replace(/\s+\/\s+.*$/, "")
    .trim();
  return titleCase(cleaned);
}

function polygonCentroid(ring: number[][]): {
  area: number;
  x: number;
  y: number;
} {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i] ?? [0, 0];
    const [x1, y1] = ring[i + 1] ?? [0, 0];
    const cross = (x0 ?? 0) * (y1 ?? 0) - (x1 ?? 0) * (y0 ?? 0);
    area += cross;
    cx += ((x0 ?? 0) + (x1 ?? 0)) * cross;
    cy += ((y0 ?? 0) + (y1 ?? 0)) * cross;
  }
  area /= 2;
  if (area === 0)
    return { area: 0, x: ring[0]?.[0] ?? 0, y: ring[0]?.[1] ?? 0 };
  return { area, x: cx / (6 * area), y: cy / (6 * area) };
}

function readNorthernIreland(file: string): RawPlace[] {
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    features: NiFeature[];
  };
  const places: RawPlace[] = [];
  for (const feature of data.features) {
    const { Name, Band, OccHH_ex } = feature.properties;
    // Bands A to F are cities and towns. G and H are villages and hamlets.
    if (!/^[A-F]$/.test(Band)) continue;
    // Statistical sub-areas of the Belfast urban area, not towns.
    if (/^METROPOLITAN /.test(Name)) continue;

    const polygons =
      feature.geometry.type === "MultiPolygon"
        ? (feature.geometry.coordinates as number[][][][])
        : [feature.geometry.coordinates as number[][][]];
    let totalArea = 0;
    let sx = 0;
    let sy = 0;
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!outer) continue;
      const c = polygonCentroid(outer);
      const weight = Math.abs(c.area);
      totalArea += weight;
      sx += c.x * weight;
      sy += c.y * weight;
    }
    if (totalArea === 0) throw new Error(`No area for ${Name}`);
    const { lat, lon } = irishGridToWgs84(sx / totalArea, sy / totalArea);
    const name = niDisplayName(Name);
    places.push({
      uri: `ni:${Name}`,
      name,
      aliases: [...(NI_EXTRA_ALIASES[name] ?? [])],
      localType: Band === "A" || Band === "B" ? "City" : "Town",
      itl1: "TLN",
      lat,
      lon,
      county: "Northern Ireland",
      district: "",
      country: "Northern Ireland",
      residents: Math.round(OccHH_ex * RESIDENTS_PER_HOUSEHOLD),
    });
  }
  return places;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface OutPlace {
  slug: string;
  name: string;
  aliases: string[];
  itl1: UkRegionCode;
  lat: number;
  lon: number;
  populationBand: number;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function buildPlaces(raw: RawPlace[]): OutPlace[] {
  // Fold places that count as part of another into its aliases.
  const folded = new Map<string, string[]>();
  const kept: RawPlace[] = [];
  for (const place of raw) {
    const target = FOLDED_INTO[place.name];
    if (target) {
      folded.set(target, [...(folded.get(target) ?? []), place.name]);
    } else {
      kept.push(place);
    }
  }

  const byBase = new Map<string, RawPlace[]>();
  for (const place of kept) {
    const base = slugify(place.name);
    byBase.set(base, [...(byBase.get(base) ?? []), place]);
  }

  const used = new Set<string>();
  const out: OutPlace[] = [];
  for (const [base, group] of [...byBase.entries()].sort((l, r) =>
    compare(l[0], r[0]),
  )) {
    const ordered = [...group].sort(
      (l, r) =>
        compare(l.county, r.county) ||
        compare(l.district, r.district) ||
        compare(l.uri, r.uri),
    );
    for (const place of ordered) {
      let slug = base;
      if (group.length > 1) {
        // County or council area first, then district, then nation.
        const qualifier =
          [place.county, place.district, place.country]
            .map((value) => slugify(value))
            .find((value) => value && value !== base) ?? "place";
        slug = slugify(`${base}-${qualifier}`);
        if (used.has(slug) && place.district) {
          slug = slugify(`${base}-${place.district}`);
        }
      }
      let unique = slug;
      for (let n = 2; used.has(unique); n += 1) unique = `${slug}-${n}`;
      used.add(unique);

      const aliases = new Set<string>(place.aliases);
      for (const alias of EXTRA_ALIASES[place.name] ?? []) aliases.add(alias);
      for (const alias of folded.get(place.name) ?? []) aliases.add(alias);
      const cityOf = /^City of (.+)$/.exec(place.name);
      if (cityOf?.[1]) aliases.add(cityOf[1]);
      aliases.delete(place.name);

      const band =
        place.residents && place.residents > 0
          ? populationBand(place.residents)
          : place.localType === "City"
            ? 3
            : 1;
      out.push({
        slug: unique,
        name: place.name,
        aliases: [...aliases].sort(compare),
        itl1: place.itl1,
        lat: round4(place.lat),
        lon: round4(place.lon),
        populationBand: band,
      });
    }
  }
  return out.sort((l, r) => compare(l.slug, r.slug));
}

/** Stable output: sorted data, then Prettier's JSON formatting so `pnpm format:check` passes. */
async function formatJson(value: unknown): Promise<string> {
  return format(JSON.stringify(value), { parser: "json" });
}

function sortedOutcodes(
  outcodes: Map<string, [number, number, UkRegionCode]>,
): Record<string, [number, number, UkRegionCode]> {
  const result: Record<string, [number, number, UkRegionCode]> = {};
  for (const key of [...outcodes.keys()].sort(compare)) {
    const value = outcodes.get(key);
    if (value) result[key] = value;
  }
  return result;
}

function buildOutcodes(
  codePointDir: string,
  votes: Map<string, Map<UkRegionCode, number>>,
): Map<string, [number, number, UkRegionCode]> {
  const sums = new Map<string, { e: number; n: number; count: number }>();
  for (const file of csvFiles(path.join(codePointDir, "Data", "CSV"))) {
    let first = true;
    for (const row of csvRows(file)) {
      // Each Code-Point Open file has a header row on the first line.
      if (first && row[0] === "PC") {
        first = false;
        continue;
      }
      first = false;
      const [postcode, quality, eastings, northings, country] = row;
      // England, Scotland and Wales only. The Channel Islands and the Isle of Man are not in the UK.
      if (!country || !/^[ESW]/.test(country)) continue;
      if (quality === "90") continue;
      const e = Number(eastings);
      const n = Number(northings);
      if (!postcode || !(e > 0) || !(n > 0)) continue;
      const outcode = outcodeOf(postcode);
      const sum = sums.get(outcode) ?? { e: 0, n: 0, count: 0 };
      sum.e += e;
      sum.n += n;
      sum.count += 1;
      sums.set(outcode, sum);
    }
  }

  const result = new Map<string, [number, number, UkRegionCode]>();
  for (const [outcode, sum] of sums) {
    const counts = votes.get(outcode);
    if (!counts) throw new Error(`No ITL1 area for outcode ${outcode}`);
    let best: UkRegionCode | null = null;
    let bestCount = 0;
    for (const [code, count] of [...counts.entries()].sort((l, r) =>
      compare(l[0], r[0]),
    )) {
      if (count > bestCount) {
        best = code;
        bestCount = count;
      }
    }
    if (!best) throw new Error(`No ITL1 area for outcode ${outcode}`);
    const { lat, lon } = britishGridToWgs84(
      sum.e / sum.count,
      sum.n / sum.count,
    );
    result.set(outcode, [round4(lat), round4(lon), best]);
  }
  return result;
}

async function main(): Promise<void> {
  const downloads = process.argv[2];
  if (!downloads) {
    console.error(
      "Usage: pnpm exec tsx scripts/geo/build-uk-geo.ts <downloads-dir> [out-dir]",
    );
    process.exit(1);
  }
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const downloadsDir = path.resolve(downloads);
  if (!path.relative(repoRoot, downloadsDir).startsWith("..")) {
    throw new Error("Keep the downloads outside the repository.");
  }
  const outDir = path.resolve(
    process.argv[3] ?? path.join(repoRoot, "src", "lib", "geo"),
  );

  const { places: gbPlaces, outcodeRegions } = readOpenNames(
    path.join(downloadsDir, "opennames"),
  );
  const niPlaces = readNorthernIreland(
    path.join(downloadsDir, "ni", "settlements-2015.json"),
  );
  const places = buildPlaces([...gbPlaces, ...niPlaces]);
  const outcodes = buildOutcodes(
    path.join(downloadsDir, "codepoint"),
    outcodeRegions,
  );

  const known = new Set<string>(UK_REGIONS.map((region) => region.code));
  for (const place of places) {
    if (!known.has(place.itl1)) throw new Error(`Bad ITL1 for ${place.slug}`);
  }

  writeFileSync(path.join(outDir, "uk-places.json"), await formatJson(places));
  writeFileSync(
    path.join(outDir, "uk-outcodes.json"),
    await formatJson(sortedOutcodes(outcodes)),
  );
  console.log(`Wrote ${places.length} places and ${outcodes.size} outcodes.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
