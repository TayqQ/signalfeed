import { eq, isNotNull, isNull, and } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, companyTags, tagThemes, themes } from "@/db/schema";

/**
 * `company_themes` (docs/spec-phase2.md section 5.3): a company is in a
 * theme when any of its tags is. Tags of a merged theme count towards the
 * theme it was merged into. Merged companies are left out.
 */

export type CompanyThemeRow = {
  companyId: number;
  themeId: number;
  tagCount: number;
};

interface ThemeLink {
  id: number;
  status: "active" | "merged";
  mergedIntoId: number | null;
}

/**
 * Maps every theme id to the active theme it now lives in, following
 * `merged_into_id` through any chain. Themes that lead nowhere active (or
 * round a loop) are left out.
 */
export function resolveActiveThemes(
  links: readonly ThemeLink[],
): Map<number, number> {
  const byId = new Map(links.map((theme) => [theme.id, theme]));
  const resolved = new Map<number, number>();
  for (const start of links) {
    const seen = new Set<number>();
    let theme: ThemeLink | undefined = start;
    while (theme && theme.status !== "active" && !seen.has(theme.id)) {
      seen.add(theme.id);
      theme =
        theme.mergedIntoId === null ? undefined : byId.get(theme.mergedIntoId);
    }
    if (theme?.status === "active") resolved.set(start.id, theme.id);
  }
  return resolved;
}

/** Company theme rows, ordered by company then theme. */
export async function computeCompanyThemes(db: Db): Promise<CompanyThemeRow[]> {
  const [themeLinks, tagRows] = await Promise.all([
    db
      .select({
        id: themes.id,
        status: themes.status,
        mergedIntoId: themes.mergedIntoId,
      })
      .from(themes),
    db
      .select({ companyId: companyTags.companyId, themeId: tagThemes.themeId })
      .from(companyTags)
      .innerJoin(tagThemes, eq(tagThemes.tagId, companyTags.tagId))
      .innerJoin(companies, eq(companies.id, companyTags.companyId))
      .where(and(isNotNull(tagThemes.themeId), isNull(companies.mergedIntoId))),
  ]);

  const active = resolveActiveThemes(themeLinks);
  const counts = new Map<string, CompanyThemeRow>();
  for (const { companyId, themeId } of tagRows) {
    if (themeId === null) continue;
    const target = active.get(themeId);
    if (target === undefined) continue;
    const key = `${companyId}:${target}`;
    const row = counts.get(key);
    if (row) row.tagCount += 1;
    else counts.set(key, { companyId, themeId: target, tagCount: 1 });
  }
  return [...counts.values()].sort(
    (a, b) => a.companyId - b.companyId || a.themeId - b.themeId,
  );
}
