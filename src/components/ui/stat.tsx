import type { ReactNode } from "react";

/** A label, a figure and an optional sub-line. A missing value shows "Not known" in muted text. */
export function Stat({
  label,
  value,
  sub,
  size = "md",
}: {
  label: string;
  value: ReactNode | null;
  sub?: ReactNode;
  size?: "md" | "lg";
}) {
  const missing = value === null || value === undefined || value === "";
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted">{label}</div>
      {missing ? (
        <div className="mt-0.5 text-[15px] text-muted">Not known</div>
      ) : (
        <div
          className={`mt-0.5 font-display font-semibold tabular-nums tracking-tight text-ink ${
            size === "lg" ? "text-[20px] sm:text-[30px]" : "text-[20px]"
          }`}
        >
          {value}
        </div>
      )}
      {sub ? <div className="mt-0.5 text-[13px] text-muted">{sub}</div> : null}
    </div>
  );
}
