import type { InvestorKind } from "@/core/enums";
import type { Clock } from "@/core/ports";

/** Company facts after post-processing: the domain is validated and tags are normalised. */
export interface CompanyFacts {
  name: string;
  websiteDomain: string | null;
  description: string | null;
  countryCode: string | null;
  city: string | null;
  foundedYear: number | null;
  tags: string[];
}

export interface InvestorFacts {
  name: string;
  kind: InvestorKind;
  websiteDomain: string | null;
}

/** True when the incoming event matches an existing event of the candidate company (Task 015). */
export type Corroboration = (candidateCompanyId: number) => Promise<boolean>;

export type CompanyMatchedBy =
  "domain" | "exact_name" | "fuzzy_corroborated" | "new";

export interface CompanyResolution {
  companyId: number;
  created: boolean;
  matchedBy: CompanyMatchedBy;
}

export interface ResolveCompanyOptions {
  corroborates: Corroboration;
  /** Defaults to the system clock. */
  clock?: Clock;
}

export type InvestorMatchedBy = "domain" | "exact_name" | "new";

export interface InvestorResolution {
  investorId: number;
  created: boolean;
  matchedBy: InvestorMatchedBy;
}
