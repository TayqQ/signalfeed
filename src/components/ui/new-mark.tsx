import { daysSince } from "./relative-date";

/** Rounds announced within this many days are "New". */
export const NEW_WITHIN_DAYS = 2;

export function isNew(date: string, now: Date): boolean {
  const days = daysSince(date, now);
  return days >= 0 && days <= NEW_WITHIN_DAYS;
}

/** A brass dot plus "New" for a round announced within 2 days. Renders nothing otherwise. */
export function NewMark({ date, now }: { date: string; now?: Date }) {
  if (!isNew(date, now ?? new Date())) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
      New
    </span>
  );
}
