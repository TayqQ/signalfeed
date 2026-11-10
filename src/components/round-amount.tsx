import type { Money } from "@/core/domain";
import type { RoundType } from "@/core/enums";
import { formatMoneyCompact } from "@/lib/format";

const SCALE_MIN = 5; // log10 of £1,000 in pence
const SCALE_MAX = 11; // log10 of £1bn in pence

const STAGE_COLOUR: Readonly<Record<RoundType, string>> = {
  pre_seed: "bg-stage-early",
  seed: "bg-stage-seed",
  series_a: "bg-stage-venture",
  series_b: "bg-stage-venture",
  series_c: "bg-stage-late",
  series_d_plus: "bg-stage-late",
  growth: "bg-stage-late",
  debt: "bg-stage-other",
  grant: "bg-stage-other",
  unknown: "bg-stage-other",
};

/** Bar width on a log scale, so a £500k seed stays visible beside a £500M round. */
export function amountBarPercent(gbpMinor: number): number {
  const position =
    (Math.log10(Math.max(gbpMinor, 1)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  return Math.round(Math.min(1, Math.max(0.03, position)) * 100);
}

export function RoundAmount({
  amount,
  amountGbpMinor,
  roundType,
}: {
  amount: Money | null;
  amountGbpMinor: number | null;
  roundType: RoundType;
}) {
  if (!amount) return <span className="text-quiet">Not reported</span>;

  const isGbp = amount.currency === "GBP";
  const original = formatMoneyCompact(amount.amountMinor, amount.currency);
  const headline =
    amountGbpMinor !== null
      ? formatMoneyCompact(amountGbpMinor, "GBP")
      : original;

  return (
    <div className="min-w-24">
      <div className="font-semibold tabular-nums">{headline}</div>
      {amountGbpMinor !== null && !isGbp ? (
        <div className="text-xs tabular-nums text-quiet">{original}</div>
      ) : null}
      {amountGbpMinor !== null ? (
        <div className="mt-1 h-1 w-full bg-zinc-200" aria-hidden="true">
          <div
            data-testid="amount-bar"
            className={`h-full ${STAGE_COLOUR[roundType]}`}
            style={{ width: `${amountBarPercent(amountGbpMinor)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
