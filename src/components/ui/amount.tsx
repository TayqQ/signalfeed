import type { Money } from "@/core/domain";
import { formatMoneyShort } from "@/lib/format";

/**
 * A round amount: GBP first, with the original currency small beneath when it
 * differs. "Undisclosed" in muted text when there is no amount.
 */
export function Amount({
  amount,
  amountGbpMinor,
  size = "sm",
}: {
  amount: Money | null;
  amountGbpMinor: number | null;
  size?: "sm" | "lg";
}) {
  if (!amount && amountGbpMinor === null) {
    return (
      <span className={size === "lg" ? "text-[17px] text-muted" : "text-muted"}>
        Undisclosed
      </span>
    );
  }

  const original = amount
    ? formatMoneyShort(amount.amountMinor, amount.currency)
    : null;
  const headline =
    amountGbpMinor !== null
      ? formatMoneyShort(amountGbpMinor, "GBP")
      : (original ?? "");
  const showOriginal =
    amountGbpMinor !== null && amount !== null && amount.currency !== "GBP";

  return (
    <span className="inline-flex flex-col leading-tight">
      <span
        className={
          size === "lg"
            ? "font-display text-[24px] font-semibold tabular-nums tracking-tight text-ink"
            : "text-[15px] font-semibold tabular-nums text-ink"
        }
      >
        {headline}
      </span>
      {showOriginal ? (
        <span className="text-xs tabular-nums text-muted">{original}</span>
      ) : null}
    </span>
  );
}
