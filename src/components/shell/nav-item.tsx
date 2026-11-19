import Link from "next/link";
import type { ComponentType } from "react";
import {
  AboutIcon,
  AcquisitionsIcon,
  FundingIcon,
  InvestorsIcon,
  StatusIcon,
  ThemesIcon,
  TrendsIcon,
} from "./icons";

export const REPO_URL = "https://github.com/TayqQ/signalfeed";
export const LICENCE_URL = `${REPO_URL}/blob/main/LICENSE`;

export interface NavEntry {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Path prefixes that make this item active. "/" matches only the home page. */
  match: readonly string[];
}

const FUNDING: NavEntry = {
  href: "/",
  label: "Funding",
  Icon: FundingIcon,
  // There is no companies index yet; a company page belongs to Funding.
  match: ["/", "/companies"],
};
const INVESTORS: NavEntry = {
  href: "/investors",
  label: "Investors",
  Icon: InvestorsIcon,
  match: ["/investors"],
};
const THEMES: NavEntry = {
  href: "/themes",
  label: "Themes",
  Icon: ThemesIcon,
  match: ["/themes"],
};
const TRENDS: NavEntry = {
  href: "/trends",
  label: "Trends",
  Icon: TrendsIcon,
  match: ["/trends"],
};
const ACQUISITIONS: NavEntry = {
  href: "/acquisitions",
  label: "Acquisitions",
  Icon: AcquisitionsIcon,
  match: ["/acquisitions"],
};
const STATUS: NavEntry = {
  href: "/status",
  label: "Status",
  Icon: StatusIcon,
  match: ["/status"],
};
const ABOUT: NavEntry = {
  href: "/about",
  label: "About",
  Icon: AboutIcon,
  match: ["/about"],
};

/** The sidebar's primary group, in order. */
export const PRIMARY_NAV: readonly NavEntry[] = [
  FUNDING,
  INVESTORS,
  THEMES,
  TRENDS,
  ACQUISITIONS,
];
/** The sidebar's lower group. */
export const LOWER_NAV: readonly NavEntry[] = [STATUS, ABOUT];
/** The phone tab bar, before More. */
export const TAB_NAV: readonly NavEntry[] = [
  FUNDING,
  INVESTORS,
  THEMES,
  TRENDS,
];
/** What the phone More sheet holds. */
export const MORE_NAV: readonly NavEntry[] = [ACQUISITIONS, STATUS, ABOUT];

function matchesPrefix(prefix: string, pathname: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when `pathname` is this item's page or one below it. */
export function isNavActive(entry: NavEntry, pathname: string): boolean {
  return entry.match.some((prefix) => matchesPrefix(prefix, pathname));
}

/**
 * One sidebar link. From 1280 px it shows its label; between 768 and 1279 px
 * the sidebar is a 64 px icon rail, the label is visually hidden and `title`
 * gives the tooltip.
 */
export function NavItem({
  entry,
  active,
}: {
  entry: NavEntry;
  active: boolean;
}) {
  const { Icon } = entry;
  return (
    <Link
      href={entry.href}
      title={entry.label}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 w-11 items-center justify-center gap-3 rounded-[var(--radius-sm)] text-[15px] xl:w-full xl:justify-start xl:px-2.5 ${
        active
          ? "bg-nav-active font-semibold text-nav-active-ink"
          : "font-medium text-nav-ink hover:bg-nav-ink/8"
      }`}
    >
      <Icon
        className={`h-5 w-5 ${active ? "text-nav-active-ink" : "text-nav-muted"}`}
      />
      <span className="sr-only xl:not-sr-only xl:truncate">{entry.label}</span>
    </Link>
  );
}
