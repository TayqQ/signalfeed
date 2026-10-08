export const EXTRACTION_PROMPT_VERSION = "v1";

const SYSTEM_PROMPT = `You extract completed startup and scale-up events from a headline and a feed summary. Return JSON for the extraction_v1 schema. Every property is required. Use null when a value is unknown. Do not guess, and do not add fields.

isRelevant is true only when the text reports a completed funding round, acquisition, or launch. Rumours (in talks, seeking, planning to raise), valuations that are not a new raise, layoffs, earnings, opinion, and recaps are not events. If nothing qualifies, set isRelevant to false and events to an empty array.

events holds at most 10 objects:
- type is funding_round, acquisition, or launch.
- company.name is the company. websiteDomain is set only when that domain appears in the text, otherwise null. description is at most 200 characters of facts, or null. countryCode is an ISO alpha-2 code or null. city and foundedYear are null when unstated. tags is zero to five short lowercase theme phrases, such as "ai agents".
- announcedOn is YYYY-MM-DD when the text states a date, otherwise null.
- funding is present for funding_round and null otherwise. roundType is pre_seed, seed, series_a, series_b, series_c, series_d_plus, growth, debt, grant, or unknown. roundLabel is the round wording as written, or null. amountText must be copied verbatim from the text, such as "$12.5M" or "€3 million", and must not be normalised. currencyHint is an ISO 4217 code when the currency is clear, otherwise null. investors lists organisations only, never individual people. kind is vc, corporate, accelerator, angel_network, government, private_equity, family_office, other, or unknown. isLead is true only if the text says that organisation led. When people invested as angels, set includesIndividualAngels to true and omit their names.
- acquisition is present for acquisition and null otherwise. acquirerName is the buyer. acquirerDomain is set only when it appears in the text. acquirerCountryCode is an ISO alpha-2 code or null. priceText is the price copied verbatim, or null. currencyHint follows the same rule as funding.
- launch is present for launch and null otherwise. kind is product, show_hn, launch_hn, open_source, or other. productName and url are null when unstated.

Example: "ExampleCo raises $4M seed led by Example Ventures" is one funding_round. amountText is "$4M". The only investor is Example Ventures, kind vc, isLead true. includesIndividualAngels is false. websiteDomain is null because the text has no domain.`;

export interface ExtractionPromptInput {
  title: string;
  summary: string | null;
  url: string;
  sourceName: string;
  publishedAt: Date | null;
}

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildUserPrompt(item: ExtractionPromptInput): string {
  const published =
    item.publishedAt === null ? "unknown" : item.publishedAt.toISOString();
  const summary = item.summary?.trim() ? item.summary.trim() : "(none)";
  return [
    `Source: ${item.sourceName}`,
    `Published: ${published}`,
    `URL: ${item.url}`,
    `Title: ${item.title}`,
    `Summary: ${summary}`,
  ].join("\n");
}
