import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LOWER_NAV,
  MORE_NAV,
  NavItem,
  PRIMARY_NAV,
  TAB_NAV,
  isNavActive,
  type NavEntry,
} from "./nav-item";

const ALL: readonly NavEntry[] = [...PRIMARY_NAV, ...LOWER_NAV];

/** The labels of the items active for `pathname`. */
function activeFor(pathname: string): string[] {
  return ALL.filter((entry) => isNavActive(entry, pathname)).map(
    (entry) => entry.label,
  );
}

describe("isNavActive", () => {
  it("makes only Funding active on the home page", () => {
    expect(activeFor("/")).toEqual(["Funding"]);
  });

  it("makes Investors active on an investor page", () => {
    expect(activeFor("/investors/byfounders")).toEqual(["Investors"]);
    expect(activeFor("/investors")).toEqual(["Investors"]);
  });

  it("makes Funding active on a company page", () => {
    expect(activeFor("/companies/x")).toEqual(["Funding"]);
  });

  it("matches whole path segments only", () => {
    expect(activeFor("/investorsx")).toEqual([]);
    expect(activeFor("/themes/fintech")).toEqual(["Themes"]);
    expect(activeFor("/ui")).toEqual([]);
  });
});

describe("nav order", () => {
  it("keeps the sidebar, tab bar and More sheet in the agreed order", () => {
    expect(PRIMARY_NAV.map((e) => e.label)).toEqual([
      "Funding",
      "Investors",
      "Themes",
      "Trends",
      "Acquisitions",
    ]);
    expect(LOWER_NAV.map((e) => e.label)).toEqual(["Status", "About"]);
    expect(TAB_NAV.map((e) => e.label)).toEqual([
      "Funding",
      "Investors",
      "Themes",
      "Trends",
    ]);
    expect(MORE_NAV.map((e) => e.label)).toEqual([
      "Acquisitions",
      "Status",
      "About",
    ]);
  });
});

describe("NavItem", () => {
  const investors = PRIMARY_NAV[1]!;

  it("marks the active item with aria-current and the active colours", () => {
    render(<NavItem entry={investors} active />);
    const link = screen.getByRole("link", { name: "Investors" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveAttribute("href", "/investors");
    expect(link).toHaveClass("bg-nav-active", "text-nav-active-ink");
  });

  it("gives an inactive item a tooltip and no aria-current", () => {
    render(<NavItem entry={investors} active={false} />);
    const link = screen.getByRole("link", { name: "Investors" });
    expect(link).not.toHaveAttribute("aria-current");
    expect(link).toHaveAttribute("title", "Investors");
  });
});
