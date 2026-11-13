/** One row of an EDGAR daily form index (`form.<yyyymmdd>.idx`). */
export interface FormIndexRow {
  formType: string;
  companyName: string;
  /** Digits as printed, without leading zeros removed. */
  cik: string;
  /** `yyyy-mm-dd`. */
  dateFiled: string;
  fileName: string;
}

const FORM_TYPE_WIDTH = 17;
const RULE = /^-{20,}\s*$/;
// Company name (any text), CIK, date filed, file name. Anchored at the end so
// wide names and names with digits in them are kept whole.
const ROW_TAIL = /^(.*?)\s+(\d{1,10})\s+(\d{8})\s+(\S+)\s*$/;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

function isoDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

/**
 * Parses the fixed-width daily form index. Skips the header block up to the
 * dashed line. Lines that do not look like a row are ignored.
 */
export function parseFormIndex(text: string): FormIndexRow[] {
  const lines = text.split(/\r?\n/);
  const rule = lines.findIndex((line) => RULE.test(line));
  if (rule === -1) return [];
  const rows: FormIndexRow[] = [];
  for (const line of lines.slice(rule + 1)) {
    if (line.trim() === "") continue;
    const formType = line.slice(0, FORM_TYPE_WIDTH).trim();
    const match = ROW_TAIL.exec(line.slice(FORM_TYPE_WIDTH));
    if (formType === "" || !match) continue;
    const [, companyName, cik, dateFiled, fileName] = match;
    if (!companyName || !cik || !dateFiled || !fileName) continue;
    rows.push({
      formType,
      companyName: companyName.trim(),
      cik,
      dateFiled: isoDate(dateFiled),
      fileName,
    });
  }
  return rows;
}

/** Keeps `D` and `D/A` only. Exact match: `DEF 14A` and `DRS` are not Form D. */
export function formDRows(rows: readonly FormIndexRow[]): FormIndexRow[] {
  return rows.filter((row) => row.formType === "D" || row.formType === "D/A");
}

/**
 * The accession number (`0001999001-26-000001`) from an index file name such as
 * `edgar/data/1999001/0001999001-26-000001.txt`. Null if it is not in that shape.
 */
export function accessionFromFileName(fileName: string): string | null {
  const base = fileName.split("/").pop() ?? "";
  const accession = base.replace(/\.txt$/i, "");
  return ACCESSION.test(accession) ? accession : null;
}
