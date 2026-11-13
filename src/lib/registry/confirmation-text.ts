import type { RecordKind } from "@/core/enums";
import { formatDate, formatMoneyCompact } from "@/lib/format";

// The wording of the "Confirmed" marker (spec-phase3 section 9.1). It lives in
// src/lib because pages must not import src/pipeline.

export interface ConfirmationTextInput {
  kind: RecordKind;
  /** YYYY-MM-DD: the allotment date, the Form D first sale, or the grant start. */
  recordDate: string;
  /**
   * Whether the record's amount agrees with the news (spec-phase3 section 9.2).
   * It does not change the wording: the marker always says what the record
   * shows, and the amount appears whenever `amountUsdMinor` is given.
   */
  confirmsAmount: boolean;
  /** Form D total sold, in US cents. */
  amountUsdMinor?: number | null;
}

/** "2 February 2026". Throws on an invalid date, like `formatDate`. */
function formatLongDate(isoDate: string): string {
  formatDate(isoDate); // validates
  const [year, month, day] = isoDate
    .trim()
    .slice(0, 10)
    .split("-")
    .map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function confirmationText(input: ConfirmationTextInput): string {
  switch (input.kind) {
    case "ch_allotment":
      return `Confirmed: shares allotted on ${formatLongDate(input.recordDate)} (Companies House SH01)`;
    case "sec_form_d": {
      const date = formatLongDate(input.recordDate);
      if (input.amountUsdMinor == null) {
        return `Confirmed: Form D, first sale ${date} (SEC)`;
      }
      // The marker is about a US filing, so a bare "$" reads naturally here.
      const amount = formatMoneyCompact(input.amountUsdMinor, "USD").replace(
        /^US\$/,
        "$",
      );
      return `Confirmed: Form D, ${amount} sold, first sale ${date} (SEC)`;
    }
    case "ukri_grant":
      return "Confirmed: Innovate UK grant (UKRI Gateway to Research)";
  }
}
