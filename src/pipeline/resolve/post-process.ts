import type { Money } from "@/core/domain";
import type { InvestorKind, LaunchKind, RoundType } from "@/core/enums";
import type { ExtractionV1 } from "@/core/extraction-schema";
import { parseAmountText } from "@/lib/money";
import { domainAppearsIn, extractDomain, normaliseTag } from "@/lib/normalise";
import type { CompanyFacts } from "./types";

/** Below 10,000 major units, a deal figure is almost certainly a misread or a product price. */
const MIN_PLAUSIBLE_MINOR = 1_000_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ProcessItem {
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date | null;
}

export interface ProcessedInvestor {
  name: string;
  kind: InvestorKind;
  isLead: boolean;
}

export interface ProcessedFunding {
  roundType: RoundType;
  roundLabel: string | null;
  amount: Money | null;
  investors: ProcessedInvestor[];
  includesIndividualAngels: boolean;
}

export interface ProcessedAcquisition {
  acquirerName: string;
  acquirerDomain: string | null;
  acquirerCountryCode: string | null;
  price: Money | null;
}

export interface ProcessedLaunch {
  kind: LaunchKind;
  productName: string | null;
  url: string | null;
}

interface ProcessedBase {
  /** Position in `extraction.result.events`, kept when earlier events are dropped. */
  eventIndex: number;
  company: CompanyFacts;
  /** A date the text states. Null means the item's published date is the fallback. */
  announcedOn: string | null;
}

export type ProcessedEvent =
  | (ProcessedBase & { type: "funding_round"; funding: ProcessedFunding })
  | (ProcessedBase & { type: "acquisition"; acquisition: ProcessedAcquisition })
  | (ProcessedBase & { type: "launch"; launch: ProcessedLaunch });

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validCountry(value: string | null): string | null {
  const code = blankToNull(value)?.toUpperCase() ?? null;
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

function validDomain(value: string | null, texts: string[]): string | null {
  const raw = blankToNull(value);
  if (!raw) return null;
  const domain = extractDomain(raw);
  return domain && domainAppearsIn(domain, texts) ? domain : null;
}

function validDate(value: string | null, latest: Date | null): string | null {
  const raw = blankToNull(value);
  const match = raw ? ISO_DATE.exec(raw) : null;
  if (!raw || !match) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== raw
  ) {
    return null;
  }
  // A date after the article's own publication is a misread.
  if (latest && parsed.getTime() > latest.getTime() + 86_400_000) return null;
  return raw;
}

function validLaunchUrl(value: string | null, texts: string[]): string | null {
  const raw = blankToNull(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return domainAppearsIn(extractDomain(raw), texts) ? url.toString() : null;
  } catch {
    return null;
  }
}

function plausibleAmount(
  text: string | null,
  hint: string | null,
): Money | null {
  const money = parseAmountText(text, hint);
  return money && money.amountMinor >= MIN_PLAUSIBLE_MINOR ? money : null;
}

function tagsOf(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalised = normaliseTag(tag);
    if (normalised) seen.add(normalised);
  }
  return [...seen].slice(0, 5);
}

/**
 * Turns raw LLM output into facts the resolver can trust: code computes the
 * amounts, and anything the source text does not support is dropped (D8).
 */
export function postProcess(
  result: ExtractionV1,
  item: ProcessItem,
): ProcessedEvent[] {
  if (!result.isRelevant) return [];
  const texts = [item.title, item.summary ?? "", item.url];
  const processed: ProcessedEvent[] = [];

  result.events.forEach((event, eventIndex) => {
    const name = blankToNull(event.company.name);
    if (!name) return;
    const base: ProcessedBase = {
      eventIndex,
      announcedOn: validDate(event.announcedOn, item.publishedAt),
      company: {
        name,
        websiteDomain: validDomain(event.company.websiteDomain, texts),
        description: blankToNull(event.company.description),
        countryCode: validCountry(event.company.countryCode),
        city: blankToNull(event.company.city),
        foundedYear: event.company.foundedYear,
        tags: tagsOf(event.company.tags),
      },
    };

    if (event.type === "funding_round" && event.funding) {
      const { funding } = event;
      const investors = new Map<string, ProcessedInvestor>();
      for (const investor of funding.investors) {
        const investorName = blankToNull(investor.name);
        if (!investorName) continue;
        const key = investorName.toLowerCase();
        const previous = investors.get(key);
        investors.set(key, {
          name: investorName,
          kind: investor.kind,
          isLead: investor.isLead || Boolean(previous?.isLead),
        });
      }
      processed.push({
        ...base,
        type: "funding_round",
        funding: {
          roundType: funding.roundType,
          roundLabel: blankToNull(funding.roundLabel),
          amount: plausibleAmount(funding.amountText, funding.currencyHint),
          investors: [...investors.values()],
          includesIndividualAngels: funding.includesIndividualAngels,
        },
      });
    } else if (event.type === "acquisition" && event.acquisition) {
      const acquirerName = blankToNull(event.acquisition.acquirerName);
      if (!acquirerName) return;
      processed.push({
        ...base,
        type: "acquisition",
        acquisition: {
          acquirerName,
          acquirerDomain: validDomain(event.acquisition.acquirerDomain, texts),
          acquirerCountryCode: validCountry(
            event.acquisition.acquirerCountryCode,
          ),
          price: plausibleAmount(
            event.acquisition.priceText,
            event.acquisition.currencyHint,
          ),
        },
      });
    } else if (event.type === "launch" && event.launch) {
      processed.push({
        ...base,
        type: "launch",
        launch: {
          kind: event.launch.kind,
          productName: blankToNull(event.launch.productName),
          url: validLaunchUrl(event.launch.url, texts),
        },
      });
    }
  });

  return processed;
}
