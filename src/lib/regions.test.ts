import { describe, expect, it } from "vitest";
import {
  COUNTRY_REGIONS,
  REGIONS,
  countriesInRegion,
  regionForCountry,
} from "./regions";

const ISO_ALPHA_2 =
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(
    /\s+/,
  );

describe("regions", () => {
  it("lists the regions the product can filter by", () => {
    expect(REGIONS).toEqual([
      "UK",
      "Europe",
      "North America",
      "Latin America",
      "Asia",
      "Middle East & Africa",
      "Oceania",
      "Unknown",
    ]);
  });

  it("maps every ISO alpha-2 code exactly once", () => {
    expect(Object.keys(COUNTRY_REGIONS).sort()).toEqual(
      [...ISO_ALPHA_2].sort(),
    );
    const seen = new Set<string>();
    for (const region of REGIONS) {
      for (const code of countriesInRegion(region)) {
        expect(seen.has(code)).toBe(false);
        seen.add(code);
        expect(regionForCountry(code)).toBe(region);
      }
    }
    expect(seen.size).toBe(ISO_ALPHA_2.length);
  });

  it("treats the UK as its own region", () => {
    expect(regionForCountry("GB")).toBe("UK");
    expect(regionForCountry("gb")).toBe("UK");
    expect(regionForCountry("UK")).toBe("UK");
    expect(countriesInRegion("UK")).toEqual(["GB"]);
    expect(countriesInRegion("Europe")).not.toContain("GB");
  });

  it("places sample countries in the expected regions", () => {
    expect(regionForCountry("FR")).toBe("Europe");
    expect(regionForCountry("US")).toBe("North America");
    expect(regionForCountry("MX")).toBe("Latin America");
    expect(regionForCountry("JP")).toBe("Asia");
    expect(regionForCountry("ZA")).toBe("Middle East & Africa");
    expect(regionForCountry("AU")).toBe("Oceania");
    expect(regionForCountry("AQ")).toBe("Unknown");
    expect(regionForCountry("XX")).toBe("Unknown");
    expect(regionForCountry(null)).toBe("Unknown");
    expect(regionForCountry("")).toBe("Unknown");
  });
});
