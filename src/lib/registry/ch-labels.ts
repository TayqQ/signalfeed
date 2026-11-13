// Companies House's own wording, from the `api-enumerations` constants
// (company_status, company_status_detail and company_type). Unknown values
// show as given.

const STATUS_LABELS: Readonly<Record<string, string>> = {
  active: "Active",
  dissolved: "Dissolved",
  liquidation: "Liquidation",
  receivership: "Receiver Action",
  "converted-closed": "Converted / Closed",
  "voluntary-arrangement": "Voluntary Arrangement",
  "insolvency-proceedings": "Insolvency Proceedings",
  administration: "In Administration",
  open: "Open",
  closed: "Closed",
  registered: "Registered",
  removed: "Removed",
};

// Details with an empty label in the constants (active, dissolved,
// converted-closed) add nothing, so they are left out.
const STATUS_DETAIL_LABELS: Readonly<Record<string, string>> = {
  "transferred-from-uk": "Transfer from UK",
  "active-proposal-to-strike-off": "Active proposal to strike off",
  "petition-to-restore-dissolved": "Petition to restore dissolved",
  "transformed-to-se": "Transformed to SE",
  "converted-to-plc": "Converted to PLC",
  "converted-to-uk-societas": "Converted to UK Societas",
  "converted-to-ukeig": "Converted to UKEIG",
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  "private-unlimited": "Private unlimited company",
  ltd: "Private limited company",
  plc: "Public limited company",
  "old-public-company": "Old public company",
  "private-limited-guarant-nsc-limited-exemption":
    "Private Limited Company by guarantee without share capital, use of 'Limited' exemption",
  "limited-partnership": "Limited partnership",
  "private-limited-guarant-nsc":
    "Private limited by guarantee without share capital",
  "converted-or-closed": "Converted / closed",
  "private-unlimited-nsc": "Private unlimited company without share capital",
  "private-limited-shares-section-30-exemption":
    "Private Limited Company, use of 'Limited' exemption",
  "protected-cell-company": "Protected cell company",
  "assurance-company": "Assurance company",
  "oversea-company": "Overseas company",
  "eeig-establishment":
    "European Economic Interest Grouping Establishment (EEIG)",
  "icvc-securities": "Investment company with variable capital",
  "icvc-warrant": "Investment company with variable capital",
  "icvc-umbrella": "Investment company with variable capital",
  "registered-society-non-jurisdictional": "Registered society",
  "industrial-and-provident-society": "Industrial and Provident society",
  "northern-ireland": "Northern Ireland company",
  "northern-ireland-other": "Credit union (Northern Ireland)",
  llp: "Limited liability partnership",
  "royal-charter": "Royal charter company",
  "investment-company-with-variable-capital":
    "Investment company with variable capital",
  "unregistered-company": "Unregistered company",
  other: "Other company type",
  "european-public-limited-liability-company-se":
    "European public limited liability company (SE)",
  "united-kingdom-societas": "United Kingdom Societas",
  "uk-establishment": "UK establishment company",
  "scottish-partnership": "Scottish qualifying partnership",
  "charitable-incorporated-organisation":
    "Charitable incorporated organisation",
  "scottish-charitable-incorporated-organisation":
    "Scottish charitable incorporated organisation",
  "further-education-or-sixth-form-college-corporation":
    "Further education or sixth form college corporation",
  eeig: "European Economic Interest Grouping (EEIG)",
  ukeig: "United Kingdom Economic Interest Grouping",
  "registered-overseas-entity": "Overseas entity",
};

function lookup(
  table: Readonly<Record<string, string>>,
  value: string | null | undefined,
): string | null {
  const key = (value ?? "").trim();
  if (key === "") return null;
  return Object.hasOwn(table, key) ? (table[key] ?? null) : null;
}

/**
 * The status in Companies House's wording, with the detail when it adds one:
 * "Active" or "Active (Active proposal to strike off)". An unknown status
 * shows as given. Null or empty gives null.
 */
export function companyStatusLabel(
  status: string | null | undefined,
  detail?: string | null,
): string | null {
  const raw = (status ?? "").trim();
  if (raw === "") return null;
  const base = lookup(STATUS_LABELS, raw) ?? raw;
  const detailKey = (detail ?? "").trim();
  if (detailKey === "") return base;
  const detailLabel = lookup(STATUS_DETAIL_LABELS, detailKey);
  if (detailLabel !== null) return `${base} (${detailLabel})`;
  // Known detail with an empty label adds nothing; an unknown one shows as given.
  return Object.hasOwn(
    { active: 1, dissolved: 1, "converted-closed": 1 },
    detailKey,
  )
    ? base
    : `${base} (${detailKey})`;
}

/** The company type in Companies House's wording. Unknown values show as given. */
export function companyTypeLabel(
  type: string | null | undefined,
): string | null {
  const raw = (type ?? "").trim();
  if (raw === "") return null;
  return lookup(TYPE_LABELS, raw) ?? raw;
}
