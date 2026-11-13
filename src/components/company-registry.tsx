import type {
  CompaniesHouseView,
  CompanyRegistryView,
} from "@/core/read-models";
import { formatDate } from "@/lib/format";
import { sizeBandLabel } from "@/lib/registry/company-size";

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

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 py-1">
      <dt className="text-quiet">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const linkClass = "text-signal underline underline-offset-4";

function CompaniesHouse({ ch }: { ch: CompaniesHouseView }) {
  return (
    <div>
      <h3 className="font-semibold">Companies House</h3>
      <dl className="mt-1 text-sm">
        <Row label="Company number">
          <a href={ch.url} rel="noopener" className={linkClass}>
            {ch.companyNumber}
          </a>
        </Row>
        <Row label="Status">{ch.statusLabel}</Row>
        <Row label="Company type">{ch.typeLabel}</Row>
        <Row label="Incorporated">{formatDate(ch.incorporatedOn)}</Row>
        {ch.sicCodes.length > 0 ? (
          <Row label="SIC codes">
            <ul>
              {ch.sicCodes.map((sic) => (
                <li key={sic.code}>
                  {sic.code}
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
      <p className="mt-1 text-sm text-quiet">Source: Companies House</p>
    </div>
  );
}

export function CompanyRegistry({
  registry,
}: {
  registry: CompanyRegistryView | null | undefined;
}) {
  if (!registry || (!registry.companiesHouse && !registry.sec)) return null;
  return (
    <section className="mt-10" aria-labelledby="registry-heading">
      <h2 id="registry-heading" className="text-xl font-semibold">
        Registry
      </h2>
      <div className="mt-3 space-y-4">
        {registry.companiesHouse ? (
          <CompaniesHouse ch={registry.companiesHouse} />
        ) : null}
        {registry.sec ? (
          <div>
            <h3 className="font-semibold">SEC EDGAR</h3>
            <dl className="mt-1 text-sm">
              <Row label="CIK">
                <a href={registry.sec.url} rel="noopener" className={linkClass}>
                  {registry.sec.cik}
                </a>
              </Row>
            </dl>
            <p className="mt-1 text-sm text-quiet">Source: SEC EDGAR</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
