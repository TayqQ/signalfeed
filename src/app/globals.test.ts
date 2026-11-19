import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MONOGRAM_TINT_PERCENT } from "@/components/ui/monogram";

const css = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");

/** Custom properties declared in the first `:root { ... }` block containing `marker`. */
function rootVars(marker: string): Map<string, string> {
  const body = new RegExp(`:root\\s*\\{([^}]*${marker}[^}]*)\\}`).exec(
    css,
  )?.[1];
  if (body === undefined)
    throw new Error(`:root block with ${marker} not found`);
  const vars = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) vars.set(name, value.trim());
  }
  return vars;
}

/** Custom properties in the explicit dark block (`:root[data-theme="dark"]`). */
function darkVars(): Map<string, string> {
  const body = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)?.[1];
  if (body === undefined) throw new Error("dark theme block not found");
  const out = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) out.set(name, value.trim());
  }
  return out;
}

// Light palette first, then the chart block (which mostly points at the palette).
const lightVars = new Map([...rootVars("--paper:"), ...rootVars("--chart-1:")]);
const themes: ReadonlyArray<[string, Map<string, string>]> = [
  ["light", lightVars],
  ["dark", new Map([...lightVars, ...darkVars()])],
];
let vars = lightVars;

function resolve(name: string): string {
  let value = vars.get(name);
  for (let i = 0; i < 5 && value?.startsWith("var("); i++) {
    value = vars.get(value.slice(4, -1));
  }
  if (value === undefined || !value.startsWith("#")) {
    throw new Error(`${name} does not resolve to a hex colour`);
  }
  return value;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB mix of `pct` percent of `a` into `b`, as a hex colour (matches CSS color-mix in srgb). */
function mix(a: string, pct: number, b: string): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const part = (shift: number) =>
    Math.round(
      (((x >> shift) & 255) * pct + ((y >> shift) & 255) * (100 - pct)) / 100,
    );
  return `#${[16, 8, 0]
    .map((sh) => part(sh).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("light chart and stage colours (WCAG 1.4.11)", () => {
  it.each([
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-bar",
    "--chart-line",
    "--chart-axis",
    "--stage-early",
    "--stage-seed",
    "--stage-venture",
    "--stage-late",
    "--stage-other",
  ])("%s is at least 3:1 against the paper", (name) => {
    vars = lightVars;
    expect(contrast(resolve(name), resolve("--paper"))).toBeGreaterThanOrEqual(
      3,
    );
  });
});

/** Text on its background: 4.5:1 (WCAG 1.4.3). */
const TEXT_PAIRS: ReadonlyArray<[string, string]> = [
  ["--ink", "--paper"],
  ["--ink", "--surface"],
  ["--ink", "--surface-sunk"],
  ["--ink", "--raised"],
  ["--ink", "--overlay"],
  ["--ink", "--brand-soft"],
  ["--ink", "--sel-bg"],
  ["--muted", "--paper"],
  ["--muted", "--surface"],
  ["--muted", "--surface-sunk"],
  ["--muted", "--raised"],
  ["--brand", "--paper"],
  ["--brand", "--surface"],
  ["--brand", "--brand-soft"],
  ["--on-brand", "--brand"],
  ["--on-brand", "--brand-hover"],
  ["--on-accent", "--accent"],
  ["--on-accent", "--accent-hover"],
  ["--nav-ink", "--nav-bg"],
  ["--nav-muted", "--nav-bg"],
  ["--nav-active-ink", "--nav-active-bg"],
  ["--accent-ink", "--paper"],
  ["--accent-ink", "--surface"],
  ["--accent-ink", "--accent-soft"],
  ["--up", "--up-soft"],
  ["--up", "--surface"],
  ["--down", "--down-soft"],
  ["--down", "--surface"],
  // --warn on --warn-soft: 5.1:1 in light after darkening --warn to #8a5710 (18 Nov 2026).
  ["--warn", "--warn-soft"],
  ["--warn", "--surface"],
  ["--info", "--info-soft"],
  ["--info", "--surface"],
];

/** Marks and graphics against the surface they sit on: 3:1 (WCAG 1.4.11). */
const MARK_PAIRS: ReadonlyArray<[string, string]> = [
  ...(["early", "seed", "venture", "late", "other"] as const).flatMap(
    (s): Array<[string, string]> => [
      [`--stage-${s}`, "--surface"],
      [`--stage-${s}`, "--paper"],
    ],
  ),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [string, string] => [
    `--data-${n}`,
    "--surface",
  ]),
  ["--accent", "--surface"],
  ["--accent", "--raised"],
  ["--sel-bar", "--sel-bg"],
  ["--logo-ring", "--paper"],
  ["--logo-dot", "--paper"],
  ["--focus", "--paper"],
  ["--focus", "--surface"],
];

describe.each(themes)("%s theme contrast", (_name, themeVars) => {
  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    vars = themeVars;
    expect(contrast(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARK_PAIRS)("%s against %s is at least 3:1", (fg, bg) => {
    vars = themeVars;
    expect(contrast(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(3);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "ink on the monogram tint of --data-%i is at least 4.5:1",
    (n) => {
      vars = themeVars;
      const tint = mix(
        resolve(`--data-${n}`),
        MONOGRAM_TINT_PERCENT,
        resolve("--surface"),
      );
      expect(contrast(resolve("--ink"), tint)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("semantic utilities", () => {
  it.each([
    "surface-sunk",
    "line",
    "line-strong",
    "muted",
    "faint",
    "brand",
    "brand-hover",
    "brand-soft",
    "on-brand",
    "accent",
    "accent-soft",
    "accent-ink",
    "up",
    "up-soft",
    "down",
    "down-soft",
    "warn",
    "warn-soft",
    "info",
    "info-soft",
    "paper",
    "surface",
    "ink",
    "data-1",
    "data-2",
    "data-3",
    "data-4",
    "data-5",
    "data-6",
    "data-7",
    "data-8",
    "stage-early",
    "stage-seed",
    "stage-venture",
    "stage-late",
    "stage-other",
    "raised",
    "overlay",
    "accent-hover",
    "on-accent",
    "nav",
    "nav-ink",
    "nav-muted",
    "nav-active",
    "nav-active-ink",
    "nav-line",
    "sel",
    "sel-bar",
    "logo-ring",
    "logo-dot",
    "logo-ink",
  ])("defines --color-%s", (name) => {
    expect(css).toMatch(new RegExp(`--color-${name}:\\s*var\\(--`));
  });
});
