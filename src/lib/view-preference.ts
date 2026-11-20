/**
 * The visitor's list view and summary state (docs/design/design-system.md
 * sections 1 and 2). Both live in cookies the server reads, so the first paint
 * is already right; `?view=` overrides the view cookie for one visit, which
 * makes view-specific links shareable. Pure helpers: the page reads the
 * cookies, the client writes them with the strings built here.
 */

export const LIST_VIEWS = ["list", "cards", "split"] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export const DEFAULT_LIST_VIEW: ListView = "split";

export const VIEW_COOKIE = "raisory_view";
export const SUMMARY_COOKIE = "raisory_summary";
/** The URL parameter that overrides the view cookie. */
export const VIEW_PARAM = "view";

/** One year, in seconds. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Split needs a screen at least this wide; below it a split choice shows List. */
export const SPLIT_MIN_WIDTH = 1100;

/** The URL parameter that holds the company open in the split preview. */
export const OPEN_PARAM = "open";

/** The longest company slug we accept from a URL (slugs are 60 characters, plus room for a suffix). */
const MAX_SLUG_LENGTH = 80;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseListView(value: unknown): ListView | undefined {
  const text: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (typeof text !== "string") return undefined;
  const lower = text.trim().toLowerCase();
  return LIST_VIEWS.find((view) => view === lower);
}

/**
 * The view to render: a valid `?view=` first, then a valid cookie, then Split.
 * Split is rendered as Split; under 1100 px CSS shows List instead
 * (see `viewsByScreen`).
 */
export function resolveListView({
  param,
  cookie,
}: {
  param?: unknown;
  cookie?: unknown;
}): ListView {
  return parseListView(param) ?? parseListView(cookie) ?? DEFAULT_LIST_VIEW;
}

/** True for a well-formed company slug: lower-case letters and digits joined by single hyphens. */
export function isCompanySlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(value)
  );
}

/** The `?open=` value when it is a well-formed slug, else undefined. */
export function parseOpenSlug(value: unknown): string | undefined {
  const text: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
  if (typeof text !== "string") return undefined;
  const slug = text.trim();
  return isCompanySlug(slug) ? slug : undefined;
}

/**
 * The company the split preview shows: the requested one when it is on this
 * page, else the first row. Null only when the page has no rows.
 */
export function resolveOpenSlug(
  slugs: readonly string[],
  requested: string | null | undefined,
): string | null {
  if (requested && slugs.includes(requested)) return requested;
  return slugs[0] ?? null;
}

/**
 * What each screen width shows for a chosen view. Phones (under 768 px) always
 * show the stacked list; Split needs at least 1100 px, so between the two it
 * shows List. The page applies this with CSS, as the server cannot know the
 * width.
 */
export function viewsByScreen(view: ListView): {
  phone: "list";
  tablet: "list" | "cards";
  wide: ListView;
} {
  return {
    phone: "list",
    tablet: view === "split" ? "list" : view,
    wide: view,
  };
}

/** The `document.cookie` assignment that remembers a view for a year. */
export function viewCookie(view: ListView): string {
  return `${VIEW_COOKIE}=${view}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * The summary's state from the `raisory_summary` cookie:
 * - `open`: no cookie (the default);
 * - `closed`: closed for this browser session (a session cookie);
 * - `hidden`: hidden by default (a one-year cookie). "Show summary" then
 *   opens it for this visit without changing the cookie.
 */
export type SummaryState = "open" | "closed" | "hidden";

export function parseSummaryState(cookie: unknown): SummaryState {
  if (typeof cookie !== "string") return "open";
  const value = cookie.trim();
  return value === "closed" || value === "hidden" ? value : "open";
}

/**
 * The `document.cookie` assignment for a summary state: `closed` is a session
 * cookie (no Max-Age), `hidden` lasts a year, and `open` clears the cookie.
 */
export function summaryCookie(state: SummaryState): string {
  if (state === "closed")
    return `${SUMMARY_COOKIE}=closed; Path=/; SameSite=Lax`;
  if (state === "hidden") {
    return `${SUMMARY_COOKIE}=hidden; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
  return `${SUMMARY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * `href` (path plus query) with the view set: Split, the default, drops the
 * parameter, so the plain URL stays canonical. Paging and filters are kept.
 */
export function withViewParam(href: string, view: ListView): string {
  const [pathPart, ...rest] = href.split("?");
  const path = pathPart || "/";
  const params = new URLSearchParams(rest.join("?"));
  if (view === DEFAULT_LIST_VIEW) params.delete(VIEW_PARAM);
  else params.set(VIEW_PARAM, view);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * `href` (path plus query) with `?open=` set to `slug`, or removed for null.
 * Every other parameter is kept.
 */
export function withOpenParam(href: string, slug: string | null): string {
  const [pathPart, ...rest] = href.split("?");
  const path = pathPart || "/";
  const params = new URLSearchParams(rest.join("?"));
  if (slug) params.set(OPEN_PARAM, slug);
  else params.delete(OPEN_PARAM);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
