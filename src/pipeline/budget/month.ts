export interface MonthWindow {
  /** Inclusive start of the UTC calendar month (00:00:00.000). */
  start: Date;
  /** Exclusive end: 00:00:00.000 UTC on the first day of the next month. */
  end: Date;
}

/** The UTC calendar month that contains `now`. */
export function monthWindowUtc(now: Date): MonthWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}
