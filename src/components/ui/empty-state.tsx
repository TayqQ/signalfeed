import type { ReactNode } from "react";

/** An honest "not known yet" panel, for example "No Companies House match yet". */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-line-strong bg-surface px-4 py-6 text-center">
      <p className="font-display text-[17px] font-semibold text-ink">{title}</p>
      {children ? (
        <p className="mt-1 text-[13px] text-muted">{children}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
