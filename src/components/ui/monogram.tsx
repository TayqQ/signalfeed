const SIZES = {
  24: "h-6 w-6 text-[10px]",
  28: "h-7 w-7 text-xs",
  40: "h-10 w-10 text-[13px]",
  56: "h-14 w-14 text-lg",
} as const;

export type MonogramSize = keyof typeof SIZES;

/** One or two letters: the first letters of the first two words. */
export function monogramLetters(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0);
  const letters = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("");
  return (letters || "?").toUpperCase();
}

/** Which of the eight data colours tints this name (stable per name). */
export function monogramTint(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return (hash % 8) + 1;
}

/** Share of the data colour mixed into the surface. Kept low so ink text stays above 4.5:1. */
export const MONOGRAM_TINT_PERCENT = 22;

export function Monogram({
  name,
  size = 28,
}: {
  name: string;
  size?: MonogramSize;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-line font-semibold text-ink ${SIZES[size]}`}
      style={{
        backgroundColor: `color-mix(in srgb, var(--data-${monogramTint(name)}) ${MONOGRAM_TINT_PERCENT}%, var(--surface))`,
      }}
    >
      {monogramLetters(name)}
    </span>
  );
}
