/**
 * Deal size bands, worked out from the GBP amount in code (no LLM).
 * A band is a size, not a stage: round type stays whatever the source states.
 * Lower bounds are inclusive and upper bounds exclusive, in pence.
 */
const POUND = 100;
const MILLION = 1_000_000 * POUND;

export const SIZE_BANDS = [
  "under-1m",
  "1m-5m",
  "5m-20m",
  "20m-100m",
  "100m-plus",
] as const;
export type SizeBand = (typeof SIZE_BANDS)[number];

interface BandRange {
  label: string;
  minGbpMinor: number;
  /** Exclusive. `null` means no upper bound. */
  maxGbpMinor: number | null;
}

export const SIZE_BAND_RANGES: Readonly<Record<SizeBand, BandRange>> = {
  "under-1m": { label: "Under £1M", minGbpMinor: 0, maxGbpMinor: MILLION },
  "1m-5m": {
    label: "£1M–£5M",
    minGbpMinor: MILLION,
    maxGbpMinor: 5 * MILLION,
  },
  "5m-20m": {
    label: "£5M–£20M",
    minGbpMinor: 5 * MILLION,
    maxGbpMinor: 20 * MILLION,
  },
  "20m-100m": {
    label: "£20M–£100M",
    minGbpMinor: 20 * MILLION,
    maxGbpMinor: 100 * MILLION,
  },
  "100m-plus": {
    label: "£100M+",
    minGbpMinor: 100 * MILLION,
    maxGbpMinor: null,
  },
};

/** The band for an amount in pence, or `null` when the amount is unknown. */
export function sizeBandFor(gbpMinor: number | null): SizeBand | null {
  if (gbpMinor === null || !Number.isFinite(gbpMinor) || gbpMinor < 0) {
    return null;
  }
  for (const band of SIZE_BANDS) {
    const { minGbpMinor, maxGbpMinor } = SIZE_BAND_RANGES[band];
    if (
      gbpMinor >= minGbpMinor &&
      (maxGbpMinor === null || gbpMinor < maxGbpMinor)
    ) {
      return band;
    }
  }
  return null;
}
