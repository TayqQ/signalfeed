import { z } from "zod";

/**
 * Gateway to Research legacy API responses (docs/sources.md, A16-A19).
 * Only the fields SignalFeed uses are listed. Unknown keys are ignored, so
 * person links and other fields never reach our code.
 */

const gtrLinkSchema = z.object({
  rel: z.string(),
  href: z.string().nullish(),
  /** Milliseconds since the Unix epoch. */
  start: z.number().nullish(),
  end: z.number().nullish(),
});

const gtrParticipantSchema = z.object({
  organisationId: z.string().min(1),
  organisationName: z.string().min(1),
  role: z.string(),
  /** Pounds, with pence as decimals. */
  grantOffer: z.number().nullish(),
  projectCost: z.number().nullish(),
});

export const gtrProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  status: z.string(),
  grantCategory: z.string(),
  leadFunder: z.string(),
  abstractText: z.string().nullish(),
  links: z.object({ link: z.array(gtrLinkSchema) }).nullish(),
  participantValues: z
    .object({ participant: z.array(gtrParticipantSchema) })
    .nullish(),
});

export const gtrProjectsPageSchema = z.object({
  page: z.number().nullish(),
  size: z.number().nullish(),
  totalPages: z.number().nullish(),
  totalSize: z.number().nullish(),
  project: z.array(gtrProjectSchema),
});

const gtrAddressSchema = z.object({
  postCode: z.string().nullish(),
  region: z.string().nullish(),
  type: z.string().nullish(),
});

export const gtrOrganisationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  regNumber: z.string().nullish(),
  website: z.string().nullish(),
  addresses: z.object({ address: z.array(gtrAddressSchema) }).nullish(),
});

export type GtrProject = z.infer<typeof gtrProjectSchema>;
export type GtrParticipant = z.infer<typeof gtrParticipantSchema>;
export type GtrProjectsPage = z.infer<typeof gtrProjectsPageSchema>;
export type GtrOrganisation = z.infer<typeof gtrOrganisationSchema>;
export type GtrAddress = z.infer<typeof gtrAddressSchema>;

/**
 * GtR stores a date as midnight in London, so a summer date arrives as 23:00
 * UTC the evening before. Reading it in London time gives the date GtR shows.
 */
const LONDON_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function msToIsoDate(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : LONDON_DATE.format(date);
}

/** Start and end dates (YYYY-MM-DD, London day) from the project's `FUND` link. */
export function projectFundDates(project: GtrProject): {
  startOn: string | null;
  endOn: string | null;
} {
  const fund = project.links?.link.find((link) => link.rel === "FUND");
  return { startOn: msToIsoDate(fund?.start), endOn: msToIsoDate(fund?.end) };
}

/** The main address, or the first address that has a postcode. */
export function mainAddress(
  organisation: GtrOrganisation,
): GtrAddress | undefined {
  const addresses = organisation.addresses?.address ?? [];
  return (
    addresses.find((address) => address.type === "MAIN_ADDRESS") ??
    addresses.find((address) => address.postCode)
  );
}
