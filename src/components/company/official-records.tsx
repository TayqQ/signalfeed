import type { ReactNode } from "react";
import type {
  CompaniesHouseView,
  CompanyRegistryView,
} from "@/core/read-models";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import { sizeBandLabel } from "@/lib/registry/company-size";
import { CompanyPanel } from "./panel";

/**
 * A status worth showing near the company name: "Dissolved on 3 May 2026", or
 * the status itself when it is not an ordinary active one (such as
 * "In Administration"). Null for an active company.
 */
export function registryStatusFact(
  registry: CompanyRegistryView | null | undefined,
): string | null {
  const ch = registry?.companiesHouse;
  if (!ch) return null;
  if (ch.ceasedOn) return `${ch.statusLabel} on ${formatDate(ch.ceasedOn)}`;
  return ch.statusLabel.startsWith("Active") ? null : ch.statusLabel;
}

const LINK = "text-brand underline underline-offset-4 hover:text-brand-hover";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
  );
}

const DL =
  "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]";

function CompaniesHouse({ ch }: { ch: CompaniesHouseView }) {
  return (
    <div>
      <dl className={DL}>
        <Row label="Company number">
          <a href={ch.url} rel="noopener" className={`${LINK} tabular-nums`}>
            {ch.companyNumber}
          </a>
        </Row>
        <Row label="Status">{ch.statusLabel}</Row>
        <Row label="Company type">{ch.typeLabel}</Row>
        <Row label="Incorporated">{formatDate(ch.incorporatedOn)}</Row>
        {ch.sicCodes.length > 0 ? (
          <Row label="SIC codes">
            <ul className="space-y-0.5">
              {ch.sicCodes.map((sic) => (
                <li key={sic.code}>
                  <span className="tabular-nums">{sic.code}</span>
                  {sic.label ? `, ${sic.label}` : ""}
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
        <Row label="Company size">
          {sizeBandLabel(ch.sizeBand)}
          {ch.accountsMadeUpTo
            ? ` (accounts made up to ${formatDate(ch.accountsMadeUpTo)})`
            : ""}
        </Row>
        {ch.officeOutcode ? (
          <Row label="Registered office">{ch.officeOutcode}</Row>
        ) : null}
      </dl>
      <p className="mt-2 text-xs text-muted">Source: Companies House</p>
    </div>
  );
}

/**
 * "From official records": the linked Companies House record and SEC filer.
 * Candidate and rejected links never reach this. Without a Companies House
 * record it says so plainly, unless a non-UK company has an SEC record.
 */
export function OfficialRecords({
  registry,
  companyName,
  countryCode,
  headingId,
}: {
  registry: CompanyRegistryView | null | undefined;
  companyName: string;
  countryCode: string | null;
  headingId: string;
}) {
  const ch = registry?.companiesHouse ?? null;
  const sec = registry?.sec ?? null;
  const outsideUk = countryCode !== null && countryCode.toUpperCase() !== "GB";
  const showEmpty = !ch && (!sec || !outsideUk);
  return (
    <CompanyPanel title="From official records" headingId={headingId}>
      <div className="space-y-4">
        {ch ? <CompaniesHouse ch={ch} /> : null}
        {showEmpty ? (
          <EmptyState title="No Companies House match yet">
            {outsideUk
              ? `Companies House covers UK companies only, and we have not matched ${companyName} to an official record.`
              : `We have not matched ${companyName} to a Companies House record, so no registry facts are shown.`}
          </EmptyState>
        ) : null}
        {sec ? (
          <div>
            <dl className={DL}>
              <Row label="SEC CIK">
                <a
                  href={sec.url}
                  rel="noopener"
                  className={`${LINK} tabular-nums`}
                >
                  {sec.cik}
                </a>
              </Row>
            </dl>
            <p className="mt-2 text-xs text-muted">Source: SEC EDGAR</p>
          </div>
        ) : null}
      </div>
    </CompanyPanel>
  );
}
