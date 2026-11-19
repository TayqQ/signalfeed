import type { ReactNode } from "react";
import type { CompanySizeBand } from "@/core/registry";
import type { CompaniesHouseView, CompanyEvent } from "@/core/read-models";
import { eventDateLabel, fundingRoundsOf } from "@/components/event-timeline";
import { Stat } from "@/components/ui/stat";
import {
  formatCompanyAge,
  formatDate,
  formatMoneyShort,
  formatRoundType,
} from "@/lib/format";

/** Short values so a fact fits a third of a phone screen. */
const SIZE_SHORT: Readonly<Record<CompanySizeBand, string>> = {
  micro: "Micro",
  small: "Small",
  medium: "Medium",
  full_accounts: "Not stated",
  dormant: "Dormant",
  no_accounts_yet: "None yet",
};

export interface KeyFact {
  label: string;
  /** Null shows "Not known". */
  value: string | null;
  sub: string | null;
  /** The sub-line is hidden on phones, where it would wrap. */
  subWide?: boolean;
  /** The value reads as a muted note, for example "Undisclosed". */
  quiet?: boolean;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * The six key facts: stage, total raised, last round, founded, company size
 * and investors. Every missing value is null, never a guess.
 */
export function keyFacts({
  events,
  foundedYear,
  companiesHouse,
  now,
}: {
  events: readonly CompanyEvent[];
  foundedYear: number | null;
  companiesHouse: CompaniesHouseView | null;
  now: Date;
}): KeyFact[] {
  const rounds = fundingRoundsOf(events);
  const latest = rounds[0] ?? null;

  const stage =
    latest && (latest.roundLabel || latest.roundType !== "unknown")
      ? (latest.roundLabel ?? formatRoundType(latest.roundType))
      : null;

  const disclosed = rounds.filter((round) => round.amountGbpMinor !== null);
  const total = disclosed.reduce(
    (sum, round) => sum + (round.amountGbpMinor ?? 0),
    0,
  );
  const undisclosed = rounds.length - disclosed.length;

  let lastValue: string | null = null;
  let lastQuiet = false;
  if (latest) {
    if (latest.amountGbpMinor !== null) {
      lastValue = formatMoneyShort(latest.amountGbpMinor, "GBP");
    } else if (latest.amount) {
      lastValue = formatMoneyShort(
        latest.amount.amountMinor,
        latest.amount.currency,
      );
    } else {
      lastValue = "Undisclosed";
      lastQuiet = true;
    }
  }

  let founded: KeyFact = { label: "Founded", value: null, sub: null };
  if (foundedYear !== null) {
    const age = formatCompanyAge(foundedYear, now.toISOString());
    founded = {
      label: "Founded",
      value: String(foundedYear),
      sub: age ? `${age} old` : null,
    };
  } else if (companiesHouse) {
    founded = {
      label: "Founded",
      value: companiesHouse.incorporatedOn.slice(0, 4),
      sub: "Incorporated",
    };
  }

  const size: KeyFact = companiesHouse
    ? {
        label: "Company size",
        value: SIZE_SHORT[companiesHouse.sizeBand],
        sub:
          companiesHouse.sizeBand === "full_accounts"
            ? "Files full accounts"
            : companiesHouse.accountsMadeUpTo
              ? `Accounts to ${formatDate(companiesHouse.accountsMadeUpTo)}`
              : "From Companies House",
        subWide: true,
      }
    : { label: "Company size", value: null, sub: null };

  const investors = new Map<string, boolean>();
  for (const round of rounds) {
    for (const investor of round.investors) {
      investors.set(
        investor.slug,
        (investors.get(investor.slug) ?? false) || investor.role === "lead",
      );
    }
  }
  const leads = [...investors.values()].filter(Boolean).length;

  return [
    { label: "Stage", value: stage, sub: null },
    {
      label: "Total raised",
      value: disclosed.length > 0 ? formatMoneyShort(total, "GBP") : null,
      sub:
        rounds.length > 0
          ? `${rounds.length} ${plural(rounds.length, "round", "rounds")}${
              undisclosed > 0 && disclosed.length > 0
                ? `, ${undisclosed} undisclosed`
                : ""
            }`
          : null,
    },
    {
      label: "Last round",
      value: lastValue,
      sub: latest ? eventDateLabel(latest) : null,
      quiet: lastQuiet,
    },
    founded,
    size,
    {
      label: "Investors",
      value: investors.size > 0 ? String(investors.size) : null,
      sub: investors.size > 0 ? `${leads} lead` : null,
    },
  ];
}

function factValue(fact: KeyFact): ReactNode {
  if (fact.value === null) return null;
  if (fact.quiet) {
    return (
      <span className="block font-sans text-[15px] font-normal leading-tight tracking-normal text-muted">
        {fact.value}
      </span>
    );
  }
  // Own line box, so the 17 px phone size and tight leading apply.
  return (
    <span className="block text-[17px] leading-tight sm:text-[20px]">
      {fact.value}
    </span>
  );
}

function factSub(fact: KeyFact): ReactNode {
  if (!fact.sub) return undefined;
  return (
    <span
      className={`${fact.subWide ? "hidden sm:block" : "block"} truncate leading-4`}
    >
      {fact.sub}
    </span>
  );
}

/** Three by two on phones, one row of six from 768 px. */
export function KeyFacts({ facts }: { facts: KeyFact[] }) {
  return (
    <section
      aria-label="Key facts"
      className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line sm:mt-6 md:grid-cols-6"
    >
      {facts.map((fact) => (
        <div key={fact.label} className="bg-surface px-3 py-2 sm:px-4 sm:py-3">
          <Stat
            label={fact.label}
            value={factValue(fact)}
            sub={factSub(fact)}
          />
        </div>
      ))}
    </section>
  );
}
