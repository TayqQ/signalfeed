import { describe, expect, it } from "vitest";
import {
  isCompanySlug,
  parseListView,
  parseOpenSlug,
  parseSummaryState,
  resolveListView,
  resolveOpenSlug,
  summaryCookie,
  viewCookie,
  viewsByScreen,
  withOpenParam,
  withViewParam,
} from "./view-preference";

describe("resolveListView", () => {
  it("is Split with no cookie and no parameter", () => {
    expect(resolveListView({})).toBe("split");
  });

  it("lets a stored List or Cards choice win over the Split default", () => {
    expect(resolveListView({ cookie: "list" })).toBe("list");
    expect(resolveListView({ cookie: "cards" })).toBe("cards");
    expect(resolveListView({ param: "list" })).toBe("list");
  });

  it("uses the cookie on its own", () => {
    expect(resolveListView({ cookie: "cards" })).toBe("cards");
    expect(resolveListView({ cookie: "list" })).toBe("list");
  });

  it("lets ?view override the cookie", () => {
    expect(resolveListView({ param: "list", cookie: "cards" })).toBe("list");
    expect(resolveListView({ param: "cards", cookie: "list" })).toBe("cards");
    expect(resolveListView({ param: ["cards", "list"] })).toBe("cards");
  });

  it("ignores invalid values and falls through to the next source", () => {
    expect(resolveListView({ param: "grid", cookie: "cards" })).toBe("cards");
    expect(resolveListView({ param: "", cookie: "tiles" })).toBe("split");
    expect(resolveListView({ param: 3, cookie: undefined })).toBe("split");
    expect(parseListView(" Cards ")).toBe("cards");
    expect(parseListView("table")).toBeUndefined();
  });

  it("renders a split choice as Split (CSS shows List under 1100 px)", () => {
    expect(resolveListView({ cookie: "split" })).toBe("split");
    expect(resolveListView({ param: "split", cookie: "cards" })).toBe("split");
  });
});

describe("viewsByScreen", () => {
  it("always shows phones the stacked list", () => {
    expect(viewsByScreen("cards").phone).toBe("list");
    expect(viewsByScreen("split").phone).toBe("list");
  });

  it("keeps Split to wide screens", () => {
    expect(viewsByScreen("split")).toEqual({
      phone: "list",
      tablet: "list",
      wide: "split",
    });
    expect(viewsByScreen("cards")).toEqual({
      phone: "list",
      tablet: "cards",
      wide: "cards",
    });
  });
});

describe("cookies", () => {
  it("remembers the view for a year, site-wide, SameSite=Lax", () => {
    expect(viewCookie("cards")).toBe(
      "raisory_view=cards; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});

describe("summary state", () => {
  it("is open with no cookie or an unknown value", () => {
    expect(parseSummaryState(undefined)).toBe("open");
    expect(parseSummaryState("")).toBe("open");
    expect(parseSummaryState("open")).toBe("open");
    expect(parseSummaryState(3)).toBe("open");
  });

  it("reads closed for the session and hidden by default", () => {
    expect(parseSummaryState("closed")).toBe("closed");
    expect(parseSummaryState(" hidden ")).toBe("hidden");
  });

  it("writes closed as a session cookie, with no Max-Age", () => {
    expect(summaryCookie("closed")).toBe(
      "raisory_summary=closed; Path=/; SameSite=Lax",
    );
  });

  it("keeps hidden by default for a year", () => {
    expect(summaryCookie("hidden")).toBe(
      "raisory_summary=hidden; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("clears the cookie to open it", () => {
    expect(summaryCookie("open")).toBe(
      "raisory_summary=; Path=/; Max-Age=0; SameSite=Lax",
    );
  });
});

describe("withViewParam", () => {
  it("sets the view and keeps the other parameters", () => {
    expect(withViewParam("/?sector=fintech&page=2", "cards")).toBe(
      "/?sector=fintech&page=2&view=cards",
    );
  });

  it("drops the parameter for Split, the default", () => {
    expect(withViewParam("/?view=cards&q=acme", "split")).toBe("/?q=acme");
    expect(withViewParam("/?view=cards", "split")).toBe("/");
  });

  it("keeps the parameter for List, so it overrides the default", () => {
    expect(withViewParam("/?q=acme", "list")).toBe("/?q=acme&view=list");
  });
});

describe("open slug", () => {
  it("accepts only well-formed slugs", () => {
    expect(isCompanySlug("northwind-robotics")).toBe(true);
    expect(isCompanySlug("a1")).toBe(true);
    expect(isCompanySlug("")).toBe(false);
    expect(isCompanySlug("Northwind")).toBe(false);
    expect(isCompanySlug("-lead")).toBe(false);
    expect(isCompanySlug("a--b")).toBe(false);
    expect(isCompanySlug("../etc")).toBe(false);
    expect(isCompanySlug("a".repeat(81))).toBe(false);
    expect(isCompanySlug(3)).toBe(false);
  });

  it("parses ?open= from a string or the first of several", () => {
    expect(parseOpenSlug(" quiet-co ")).toBe("quiet-co");
    expect(parseOpenSlug(["quiet-co", "other"])).toBe("quiet-co");
    expect(parseOpenSlug("Quiet Co")).toBeUndefined();
    expect(parseOpenSlug(undefined)).toBeUndefined();
  });

  it("keeps the requested company only when it is on the page", () => {
    const slugs = ["a", "b", "c"];
    expect(resolveOpenSlug(slugs, "b")).toBe("b");
    expect(resolveOpenSlug(slugs, "z")).toBe("a");
    expect(resolveOpenSlug(slugs, undefined)).toBe("a");
    expect(resolveOpenSlug([], "a")).toBeNull();
  });

  it("sets and clears ?open= and keeps the other parameters", () => {
    expect(withOpenParam("/?view=split&page=2", "b")).toBe(
      "/?view=split&page=2&open=b",
    );
    expect(withOpenParam("/?open=a&view=split", "b")).toBe(
      "/?open=b&view=split",
    );
    expect(withOpenParam("/?open=a&view=split", null)).toBe("/?view=split");
    expect(withOpenParam("/", "a")).toBe("/?open=a");
  });
});
