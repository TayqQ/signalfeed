import type { RoundType } from "@/core/enums";
import { formatRoundType } from "@/lib/format";
import { STAGE_BG, stageBucket } from "@/lib/stage";

/**
 * The stage as text plus a small marker in the stage ramp. The text is always
 * present, so colour is never the only cue. `label` overrides the text (for
 * example "Series F") while the colour still comes from the round type.
 */
export function StageChip({
  roundType,
  label,
}: {
  roundType: RoundType;
  label?: string;
}) {
  const bucket = stageBucket(roundType);
  return (
    <span
      data-stage={bucket}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${STAGE_BG[bucket]}`}
      />
      {label ?? formatRoundType(roundType)}
    </span>
  );
}
