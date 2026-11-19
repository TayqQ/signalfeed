import { describe, expect, it } from "vitest";
import { chooseMainSector } from "./main-sector";

describe("chooseMainSector", () => {
  it("uses the sector of the strongest theme", () => {
    expect(
      chooseMainSector({
        themes: [
          { themeId: 1, tagCount: 1, sector: "financial-services" },
          { themeId: 2, tagCount: 4, sector: "health-life-sciences" },
        ],
        sicCodes: ["62012"],
      }),
    ).toBe("health-life-sciences");
  });

  it("falls back to the SIC sector when there is no theme sector", () => {
    expect(
      chooseMainSector({
        themes: [{ themeId: 1, tagCount: 3, sector: null }],
        sicCodes: ["62012"],
      }),
    ).toBe("software-ai");
    expect(chooseMainSector({ themes: [], sicCodes: ["21100"] })).toBe(
      "health-life-sciences",
    );
  });

  it("is null with neither, and never other", () => {
    expect(chooseMainSector({ themes: [], sicCodes: [] })).toBeNull();
    expect(chooseMainSector({ themes: [], sicCodes: ["99999", "70229"] })).toBe(
      null,
    );
    expect(
      chooseMainSector({
        themes: [{ themeId: 1, tagCount: 9, sector: "other" }],
        sicCodes: [],
      }),
    ).toBeNull();
  });

  it("breaks a tie by the lowest theme id", () => {
    expect(
      chooseMainSector({
        themes: [
          { themeId: 7, tagCount: 2, sector: "climate-energy" },
          { themeId: 3, tagCount: 2, sector: "education" },
          { themeId: 9, tagCount: 2, sector: "software-ai" },
        ],
        sicCodes: [],
      }),
    ).toBe("education");
  });

  it("breaks a SIC tie by sector order", () => {
    expect(chooseMainSector({ themes: [], sicCodes: ["35110", "62012"] })).toBe(
      "software-ai",
    );
  });
});
