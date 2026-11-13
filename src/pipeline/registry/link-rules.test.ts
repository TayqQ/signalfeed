import { describe, expect, it } from "vitest";
import type {
  CapitalFiling,
  FormDFacts,
  RegistryCompanyFacts,
} from "@/core/registry";
import type { ConfirmableEvent } from "./confirm-rules";
import {
  chConflicts,
  decideChLink,
  decideFormDLink,
  filingSignal,
  grantPostcodeSignal,
  locationSignal,
  registryNameMatch,
  registryNormalise,
  type ChLinkCandidate,
  type ChLinkCompany,
  type ChLinkInput,
  type FormDLinkCompany,
} from "./link-rules";

const LEEDS = { label: "Leeds", lat: 53.8016, lon: -1.5472 };
const LONDON = { label: "London", lat: 51.5078, lon: -0.1245 };

let nextEventId = 1;
function round(
  announcedOn: string,
  overrides: Partial<ConfirmableEvent> = {},
): ConfirmableEvent {
  nextEventId += 1;
  return {
    id: nextEventId,
    type: "funding_round",
    roundType: "seed",
    announcedOn,
    datePrecision: "day",
    amountUsdMinor: null,
    ...overrides,
  };
}

function company(overrides: Partial<ChLinkCompany> = {}): ChLinkCompany {
  return {
    names: ["Brightwell Robotics"],
    countryCode: "GB",
    foundedYear: null,
    events: [round("2026-03-10")],
    location: null,
    grantPostcodes: [],
    grantCompanyNumber: null,
    rejectedNumbers: [],
    ...overrides,
  };
}

function profile(
  overrides: Partial<RegistryCompanyFacts> = {},
): RegistryCompanyFacts {
  return {
    companyNumber: "13579246",
    name: "BRIGHTWELL ROBOTICS LTD",
    previousNames: [],
    status: "active",
    companyType: "ltd",
    incorporatedOn: "2022-06-01",
    ceasedOn: null,
    sicCodes: [],
    officePostcode: "LS1 4AP",
    officeOutcode: "LS1",
    accountsType: null,
    accountsMadeUpTo: null,
    ...overrides,
  };
}

function sh01(actionDate: string): CapitalFiling {
  return {
    transactionId: `t-${actionDate}`,
    type: "SH01",
    filedOn: actionDate,
    actionDate,
    capital: null,
  };
}

function candidate(
  overrides: Partial<RegistryCompanyFacts> = {},
  filings: CapitalFiling[] | null = [],
  officePostcodeShared = false,
): ChLinkCandidate {
  return { profile: profile(overrides), filings, officePostcodeShared };
}

function decide(
  co: ChLinkCompany,
  candidates: ChLinkCandidate[],
  linkedToOthers: string[] = [],
) {
  const input: ChLinkInput = { company: co, candidates, linkedToOthers };
  return decideChLink(input);
}

describe("registryNameMatch (spec-phase3 section 7.2)", () => {
  it.each([
    [["Brightwell Robotics"], "BRIGHTWELL ROBOTICS LTD", "exact"],
    [["Brightwell Robotics Ltd"], "Brightwell Robotics Limited", "exact"],
    [["Kite & Kettle"], "KITE AND KETTLE LTD", "exact"],
    [["Re-Frame Labs"], "REFRAME LABS LTD", "exact"],
    [["AcmeBio"], "ACME BIO LTD", "exact"],
    [["Quarry Labs"], "QUARRY LABS TECHNOLOGIES LTD", "exact"],
    [["Tidewell"], "TIDEWELL PLATFORM LTD", "prefix"],
    [["Ferngrove"], "FERNGROVE UK LTD", "prefix"],
    [["Halyard"], "HALYARD HOLDINGS LTD", "prefix"],
    [["Tide"], "TIDEWELL PLATFORM LTD", "none"],
    [["Brightwell Robotics"], "BRIGHTWELL LTD", "none"],
    [["Q2"], "Q2 LTD", "none"],
  ] as const)("%j vs %j is %s", (names, registryName, expected) => {
    expect(registryNameMatch(names, registryName)).toBe(expected);
  });

  it("matches an alias as well as the name", () => {
    expect(
      registryNameMatch(["Glowtern", "Glowtern Energy"], "GLOWTERN ENERGY LTD"),
    ).toBe("exact");
  });

  it("counts previous names for exact matches only", () => {
    expect(
      registryNameMatch(["Copperwick"], "SALTMARSH ENERGY LTD", [
        "COPPERWICK LTD",
      ]),
    ).toBe("exact");
    expect(
      registryNameMatch(["Driftlight"], "FERNHOLLOW LTD", [
        "DRIFTLIGHT MEDIA LTD",
      ]),
    ).toBe("none");
  });

  it("reads & as 'and'", () => {
    expect(registryNormalise("Kite & Kettle Ltd")).toBe("kite and kettle");
  });
});

describe("chConflicts (step 2)", () => {
  it("too young: incorporated after the earliest event", () => {
    expect(
      chConflicts(
        company({ events: [round("2024-11-12")] }),
        profile({ incorporatedOn: "2025-08-01" }),
      ),
    ).toEqual([expect.stringMatching(/^too young/)]);
  });

  it("a month event counts to the end of its month", () => {
    const co = company({
      events: [round("2024-03-01", { datePrecision: "month" })],
    });
    expect(chConflicts(co, profile({ incorporatedOn: "2024-03-20" }))).toEqual(
      [],
    );
    expect(chConflicts(co, profile({ incorporatedOn: "2024-04-01" }))).toEqual([
      expect.stringMatching(/^too young/),
    ]);
  });

  it("closed too early: ceased before the latest event", () => {
    const co = company({ events: [round("2024-03-05"), round("2026-01-20")] });
    expect(
      chConflicts(
        co,
        profile({ incorporatedOn: "2018-01-01", ceasedOn: "2023-04-11" }),
      ),
    ).toEqual([expect.stringMatching(/^closed too early/)]);
    expect(
      chConflicts(
        co,
        profile({ incorporatedOn: "2018-01-01", ceasedOn: "2026-05-01" }),
      ),
    ).toEqual([]);
  });

  it("dormant through a round: only when the round is inside the accounts year", () => {
    const dormant = {
      accountsType: "dormant",
      accountsMadeUpTo: "2026-03-31",
      incorporatedOn: "2009-01-01",
    };
    expect(
      chConflicts(company({ events: [round("2025-11-04")] }), profile(dormant)),
    ).toEqual([expect.stringMatching(/^dormant through a round/)]);
    expect(
      chConflicts(company({ events: [round("2026-05-01")] }), profile(dormant)),
    ).toEqual([]);
    expect(
      chConflicts(company({ events: [round("2025-03-31")] }), profile(dormant)),
    ).toEqual([]);
    expect(
      chConflicts(
        company({ events: [round("2025-11-04", { roundType: "grant" })] }),
        profile(dormant),
      ),
    ).toEqual([]);
  });

  it("no share capital conflicts with an equity round, not with a grant", () => {
    const guarantee = profile({ companyType: "private-limited-guarant-nsc" });
    expect(chConflicts(company(), guarantee)).toEqual([
      expect.stringMatching(/^no share capital/),
    ]);
    expect(
      chConflicts(
        company({ events: [round("2026-01-01", { roundType: "grant" })] }),
        guarantee,
      ),
    ).toEqual([]);
  });

  it("founded year disagrees by more than 2", () => {
    const p = profile({ incorporatedOn: "2019-09-16" });
    expect(chConflicts(company({ foundedYear: 2021 }), p)).toEqual([]);
    expect(chConflicts(company({ foundedYear: 2022 }), p)).toEqual([
      expect.stringMatching(/^founded year disagrees/),
    ]);
    expect(chConflicts(company({ foundedYear: 2016 }), p)).toEqual([
      expect.stringMatching(/^founded year disagrees/),
    ]);
  });

  it("taken: a number linked to another company is a merge candidate, not a link", () => {
    const result = decide(
      company({ names: ["AcmeBio"], location: LEEDS }),
      [
        candidate({ companyNumber: "09876543", name: "ACME BIO LTD" }, [
          sh01("2026-02-02"),
        ]),
      ],
      ["09876543"],
    );
    expect(result.outcome).toBe("none");
    expect(result.decisions[0]?.outcome).toBe("none");
    expect(result.decisions[0]?.reason).toContain("taken");
    expect(result.mergeCandidates).toEqual([
      {
        registryId: "09876543",
        reason: "same Companies House number (09876543)",
      },
    ]);
  });
});

describe("support signals (step 3)", () => {
  it("S1: same full postcode, or the same district", () => {
    const c = candidate({ officePostcode: "NE1 5DL", officeOutcode: "NE1" });
    expect(grantPostcodeSignal({ grantPostcodes: ["ne15dl"] }, c)).toMatch(
      /^S1 grant postcode is the office postcode/,
    );
    expect(grantPostcodeSignal({ grantPostcodes: ["NE1 4ST"] }, c)).toMatch(
      /^S1 grant postcode in the office district NE1/,
    );
    expect(grantPostcodeSignal({ grantPostcodes: ["NE2 4ST"] }, c)).toBeNull();
  });

  it("S1: a shared office postcode counts only on a full match", () => {
    const shared = candidate(
      { officePostcode: "EC1V 2NX", officeOutcode: "EC1V" },
      [],
      true,
    );
    expect(
      grantPostcodeSignal({ grantPostcodes: ["EC1V 4PW"] }, shared),
    ).toBeNull();
    expect(
      grantPostcodeSignal({ grantPostcodes: ["EC1V 2NX"] }, shared),
    ).not.toBeNull();
  });

  it("S2: office district within 25 km of the town", () => {
    expect(locationSignal({ location: LEEDS }, candidate())).toBe(
      "S2 LS1 0 km from Leeds",
    );
    expect(locationSignal({ location: LONDON }, candidate())).toBeNull();
    expect(
      locationSignal(
        { location: { label: "Reading", lat: 51.4542, lon: -0.9707 } },
        candidate({ officePostcode: "GU1 4RA", officeOutcode: "GU1" }),
      ),
    ).toBeNull();
    expect(
      locationSignal(
        { location: { label: "Brighton", outcode: "BN1" } },
        candidate({ officePostcode: "BN1 4GH", officeOutcode: null }),
      ),
    ).toBe("S2 BN1 0 km from Brighton");
  });

  it("S2: ignored for a shared office postcode or a district with no centroid", () => {
    expect(
      locationSignal({ location: LEEDS }, candidate({}, [], true)),
    ).toBeNull();
    expect(
      locationSignal(
        { location: { label: "Belfast", lat: 54.5993, lon: -5.9295 } },
        candidate({ officePostcode: "BT3 9DT", officeOutcode: "BT3" }),
      ),
    ).toBeNull();
    expect(locationSignal({ location: null }, candidate())).toBeNull();
  });

  it("S3: an SH01 from 120 days before to 30 days after an equity round", () => {
    const co = { events: [round("2026-03-10")] };
    expect(filingSignal(co, { filings: [sh01("2026-02-02")] })).toBe(
      "S3 SH01 2026-02-02, 36 days before seed 2026-03-10",
    );
    expect(filingSignal(co, { filings: [sh01("2025-09-01")] })).toBeNull();
    expect(filingSignal(co, { filings: [] })).toBeNull();
    expect(filingSignal(co, { filings: null })).toBeUndefined();
    expect(
      filingSignal(
        { events: [round("2026-03-10", { roundType: "debt" })] },
        { filings: [sh01("2026-02-02")] },
      ),
    ).toBeNull();
  });
});

describe("decideChLink (step 4)", () => {
  it("one exact candidate with S1 links by grant postcode", () => {
    const result = decide(
      company({ grantPostcodes: ["LS1 4AP"], location: LEEDS }),
      [candidate({}, [sh01("2026-02-02")])],
    );
    expect(result.outcome).toBe("linked");
    expect(result.decisions[0]).toMatchObject({
      method: "name_grant_postcode",
    });
  });

  it("one exact candidate with S3 links by filing, ahead of S2", () => {
    const result = decide(company({ location: LEEDS }), [
      candidate({}, [sh01("2026-02-02")]),
    ]);
    expect(result.decisions[0]).toMatchObject({
      outcome: "linked",
      method: "name_filing",
      reason:
        "exact name; S3 SH01 2026-02-02, 36 days before seed 2026-03-10; S2 LS1 0 km from Leeds",
    });
  });

  it("one exact candidate with S2 only links by location when the name has two words", () => {
    const result = decide(company({ location: LEEDS }), [candidate()]);
    expect(result.decisions[0]).toMatchObject({
      outcome: "linked",
      method: "name_location",
    });
  });

  it("a single-word name is not linked by location alone", () => {
    const result = decide(company({ names: ["Atlas"], location: LONDON }), [
      candidate({
        name: "ATLAS LTD",
        officePostcode: "WC2H 9JQ",
        officeOutcode: "WC2H",
      }),
    ]);
    expect(result.outcome).toBe("candidates");
    expect(result.decisions[0]?.reason).toContain("single-word name");
  });

  it("one exact candidate with no signal becomes a candidate", () => {
    const result = decide(company(), [candidate()]);
    expect(result.outcome).toBe("candidates");
    expect(result.decisions[0]).toMatchObject({ outcome: "candidate" });
  });

  it("asks for filings only when they could change the decision", () => {
    const pending = decide(company(), [candidate({}, null)]);
    expect(pending.needsFilings).toEqual(["13579246"]);
    expect(pending.outcome).toBe("candidates");
    const withS1 = decide(company({ grantPostcodes: ["LS1 4AP"] }), [
      candidate({}, null),
    ]);
    expect(withS1.needsFilings).toEqual([]);
    const noRound = decide(
      company({ events: [round("2026-01-01", { roundType: "grant" })] }),
      [candidate({}, null)],
    );
    expect(noRound.needsFilings).toEqual([]);
    const several = decide(company(), [
      candidate({}, null),
      candidate(
        {
          companyNumber: "13579247",
          name: "BRIGHTWELL ROBOTICS TECHNOLOGIES LTD",
        },
        null,
      ),
    ]);
    expect(several.needsFilings).toEqual([]);
  });

  it("several exact candidates all become candidates", () => {
    const result = decide(company({ location: LEEDS }), [
      candidate({}, [sh01("2026-02-02")]),
      candidate(
        {
          companyNumber: "13579247",
          name: "BRIGHTWELL ROBOTICS TECHNOLOGIES LTD",
        },
        [sh01("2026-02-02")],
      ),
    ]);
    expect(result.outcome).toBe("candidates");
    expect(result.decisions.map((d) => d.outcome)).toEqual([
      "candidate",
      "candidate",
    ]);
  });

  it("a prefix candidate with both S2 and S3 goes to review (D61)", () => {
    const result = decide(company({ names: ["Brightwell"], location: LEEDS }), [
      candidate({}, [sh01("2026-02-02")]),
    ]);
    expect(result.outcome).toBe("candidates");
    expect(result.decisions[0]?.outcome).toBe("candidate");
    expect(result.decisions[0]?.reason).toContain("trading name");
  });

  it("sends at most three prefix candidates to review", () => {
    const result = decide(
      company({ names: ["Orion"] }),
      [1, 2, 3, 4, 5].map((n) =>
        candidate({ companyNumber: `0600000${n}`, name: `ORION WORD${n} LTD` }),
      ),
    );
    expect(result.decisions.map((d) => d.outcome)).toEqual([
      "candidate",
      "candidate",
      "candidate",
      "none",
      "none",
    ]);
  });

  it("nothing left gives none", () => {
    const result = decide(company(), [candidate({ name: "UNRELATED LTD" })]);
    expect(result.outcome).toBe("none");
    expect(decide(company(), []).outcome).toBe("none");
  });

  it("skips a company with no name of at least 3 characters", () => {
    const result = decide(company({ names: ["Q2"] }), [
      candidate({ name: "Q2 LTD" }, [sh01("2026-02-02")]),
    ]);
    expect(result.outcome).toBe("skipped");
  });

  it("never proposes a manually rejected number", () => {
    const result = decide(
      company({ rejectedNumbers: ["13579246"], location: LEEDS }),
      [candidate({}, [sh01("2026-02-02")])],
    );
    expect(result.outcome).toBe("none");
    expect(result.mergeCandidates).toEqual([]);
  });

  it("does not link a company whose country is not GB", () => {
    const result = decide(company({ countryCode: "US", location: LEEDS }), [
      candidate({}, [sh01("2026-02-02")]),
    ]);
    expect(result.outcome).toBe("candidates");
  });

  describe("step 0: a grant number", () => {
    it("links when the name matches exactly", () => {
      const result = decide(company({ grantCompanyNumber: "13579246" }), [
        candidate(),
      ]);
      expect(result.decisions[0]).toMatchObject({
        outcome: "linked",
        method: "grant_number",
      });
    });

    it("pads the number before comparing", () => {
      const result = decide(company({ grantCompanyNumber: "9876543" }), [
        candidate({ companyNumber: "09876543" }),
      ]);
      expect(result.decisions[0]).toMatchObject({ method: "grant_number" });
    });

    it("records a candidate when the name differs, and links nothing else", () => {
      const result = decide(
        company({ grantCompanyNumber: "10293847", location: LEEDS }),
        [
          candidate({
            companyNumber: "10293847",
            name: "NORTHGATE COMPOSITES LTD",
          }),
          candidate({}, [sh01("2026-02-02")]),
        ],
      );
      expect(result.outcome).toBe("candidates");
      expect(result.decisions).toEqual([
        expect.objectContaining({
          registryId: "10293847",
          reason: "grant number, name differs",
        }),
        expect.objectContaining({
          registryId: "13579246",
          outcome: "candidate",
        }),
      ]);
    });

    it("records a candidate when a conflict appears", () => {
      const result = decide(company({ grantCompanyNumber: "13579246" }), [
        candidate({ ceasedOn: "2025-01-01" }),
      ]);
      expect(result.decisions[0]).toMatchObject({ outcome: "candidate" });
    });
  });

  describe("worked examples (spec-phase3 section 7.2)", () => {
    it("1. Brightwell Robotics: linked by filing; the prefix match is not considered", () => {
      const result = decide(
        company({
          events: [round("2026-03-10", { amountUsdMinor: 265_000_000 })],
          location: LEEDS,
        }),
        [
          candidate({}, [sh01("2026-02-02")]),
          candidate({
            companyNumber: "14002211",
            name: "BRIGHTWELL ROBOTICS SERVICES LTD",
            officePostcode: "LS11 5DR",
            officeOutcode: "LS11",
          }),
        ],
      );
      expect(result.outcome).toBe("linked");
      expect(result.decisions).toEqual([
        expect.objectContaining({
          registryId: "13579246",
          outcome: "linked",
          method: "name_filing",
        }),
        expect.objectContaining({ registryId: "14002211", outcome: "none" }),
      ]);
    });

    it("2. Nova: a short name with no support is a candidate", () => {
      const result = decide(
        company({ names: ["Nova"], events: [round("2026-05-01")] }),
        [
          candidate({
            companyNumber: "06812345",
            name: "NOVA LTD",
            incorporatedOn: "2009-02-11",
            officePostcode: "BS1 4DJ",
            officeOutcode: "BS1",
            accountsType: "dormant",
            accountsMadeUpTo: "2026-03-31",
          }),
        ],
      );
      expect(result.outcome).toBe("candidates");
    });

    it("3. Kestrel AI: incorporated after the first event, none", () => {
      const result = decide(
        company({
          names: ["Kestrel AI"],
          foundedYear: 2023,
          events: [round("2024-11-12")],
        }),
        [candidate({ name: "KESTREL AI LTD", incorporatedOn: "2025-08-01" })],
      );
      expect(result.outcome).toBe("none");
      expect(result.decisions.every((d) => d.outcome === "none")).toBe(true);
    });

    it("4. Fenwick Thermal: linked by grant postcode", () => {
      const result = decide(
        company({
          names: ["Fenwick Thermal Ltd"],
          events: [
            round("2025-06-01", { roundType: "grant", datePrecision: "month" }),
          ],
          grantPostcodes: ["NE1 5DL"],
        }),
        [
          candidate({
            companyNumber: "11223344",
            name: "FENWICK THERMAL LTD",
            officePostcode: "NE1 5DL",
            officeOutcode: "NE1",
          }),
        ],
      );
      expect(result.decisions[0]).toMatchObject({
        outcome: "linked",
        method: "name_grant_postcode",
      });
    });

    it("5. Tidewell: prefix matches go to review under D61, not linked", () => {
      const result = decide(
        company({
          names: ["Tidewell"],
          events: [round("2026-01-20")],
          location: LONDON,
        }),
        [
          candidate(
            {
              companyNumber: "12456780",
              name: "TIDEWELL PLATFORM LTD",
              officePostcode: "EC2A 4NE",
              officeOutcode: "EC2A",
            },
            [sh01("2025-12-15")],
          ),
          candidate({
            companyNumber: "12456781",
            name: "TIDEWELL HOLDINGS LTD",
            officePostcode: "EC2A 4NE",
            officeOutcode: "EC2A",
          }),
        ],
      );
      expect(result.outcome).toBe("candidates");
      expect(result.decisions.map((d) => d.outcome)).toEqual([
        "candidate",
        "candidate",
      ]);
    });

    it("6. AcmeBio: the same number as Acme Bio makes a merge candidate", () => {
      const result = decide(
        company({ names: ["AcmeBio"] }),
        [candidate({ companyNumber: "09876543", name: "ACME BIO LTD" })],
        ["09876543"],
      );
      expect(result.outcome).toBe("none");
      expect(result.mergeCandidates.map((m) => m.registryId)).toEqual([
        "09876543",
      ]);
    });
  });
});

describe("decideFormDLink (spec-phase3 section 8.3)", () => {
  function filing(overrides: Partial<FormDFacts> = {}): FormDFacts {
    return {
      accessionNumber: "0001999999-26-000001",
      cik: "1999999",
      issuerName: "Orbital Forge, Inc.",
      entityType: "Corporation",
      issuerState: "CA",
      issuerCity: null,
      yearOfInc: null,
      industryGroup: null,
      isAmendment: false,
      dateOfFirstSale: "2026-01-05",
      totalOfferingUsdMinor: null,
      totalSoldUsdMinor: 440_000_000,
      filedOn: "2026-01-16",
      ...overrides,
    };
  }

  function us(overrides: Partial<FormDLinkCompany> = {}): FormDLinkCompany {
    return {
      companyId: 1,
      names: ["Orbital Forge"],
      countryCode: "US",
      secCik: null,
      foundedYear: null,
      events: [round("2026-02-18", { id: 10, amountUsdMinor: 450_000_000 })],
      ...overrides,
    };
  }

  it("worked example: Orbital Forge is linked and confirmed", () => {
    expect(decideFormDLink(filing(), [us()])).toEqual({
      outcome: "linked",
      companyId: 1,
      method: "form_d_round",
      eventId: 10,
      reason:
        "exact name; Form D first sale 2026-01-05, 44 days before seed 2026-02-18; amounts agree",
    });
  });

  it("a company linked to the CIK owns the filing", () => {
    expect(
      decideFormDLink(filing({ issuerName: "Other Name Inc" }), [
        us({ companyId: 2, secCik: "1999999" }),
      ]),
    ).toMatchObject({ outcome: "owned", companyId: 2 });
  });

  it.each([
    ["a non-US country", { countryCode: "GB" }],
    ["another CIK", { secCik: "1777777" }],
    ["a manual rejection", { rejectedCiks: ["1999999"] }],
    ["a founded year 3 years off", { foundedYear: 2020 }],
  ])("conflicts on %s", (_label, overrides: Partial<FormDLinkCompany>) => {
    expect(
      decideFormDLink(filing({ yearOfInc: 2023 }), [us(overrides)]).outcome,
    ).toBe("none");
  });

  it("several companies with the name give none", () => {
    expect(
      decideFormDLink(filing(), [us(), us({ companyId: 2 })]).outcome,
    ).toBe("none");
  });

  it("a round within 365 days that the Form D does not confirm gives a candidate", () => {
    const result = decideFormDLink(filing({ totalSoldUsdMinor: 50_000_000 }), [
      us(),
    ]);
    expect(result).toMatchObject({ outcome: "candidate", companyId: 1 });
  });

  it("no round near the filing gives none", () => {
    expect(
      decideFormDLink(filing(), [us({ events: [round("2024-01-10")] })])
        .outcome,
    ).toBe("none");
  });

  it("a single-word name needs amounts to compare", () => {
    const atlas = us({
      names: ["Atlas"],
      events: [round("2026-02-18", { amountUsdMinor: null })],
    });
    expect(
      decideFormDLink(filing({ issuerName: "Atlas LLC" }), [atlas]).outcome,
    ).toBe("candidate");
    const quorvex = us({ names: ["Quorvex"] });
    expect(
      decideFormDLink(filing({ issuerName: "Quorvex, Inc." }), [quorvex])
        .outcome,
    ).toBe("linked");
  });

  it("a multi-word name links on the date when no amount is known", () => {
    expect(
      decideFormDLink(filing({ totalSoldUsdMinor: null }), [
        us({ events: [round("2026-02-18", { amountUsdMinor: null })] }),
      ]).outcome,
    ).toBe("linked");
  });
});
