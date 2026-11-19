import { formatDate } from "@/lib/format";

const DAY_MS = 86_400_000;
/** Beyond this many days the date is shown in full. */
export const RELATIVE_DATE_DAYS = 14;

/** Whole UTC days from `isoDate` to `now`. Negative for a future date. */
export function daysSince(isoDate: string, now: Date): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) throw new Error(`Invalid date: ${isoDate}`);
  const then = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((today - then) / DAY_MS);
}

export function relativeDateLabel(isoDate: string, now: Date): string {
  const days = daysSince(isoDate, now);
  if (days < 0 || days > RELATIVE_DATE_DAYS) return formatDate(isoDate);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** "Yesterday", "4 days ago", then a date after 14 days. The exact date is in the title. */
export function RelativeDate({ date, now }: { date: string; now?: Date }) {
  const exact = formatDate(date);
  return (
    <time
      dateTime={date.slice(0, 10)}
      title={exact}
      className="tabular-nums text-muted"
    >
      {relativeDateLabel(date, now ?? new Date())}
    </time>
  );
}
