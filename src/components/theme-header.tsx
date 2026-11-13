import type { TagRef, ThemeSummary, WeeklyPoint } from "@/core/read-models";
import { SECTOR_LABELS } from "@/core/sectors";
import { TagList } from "./tag-list";

export function ThemeHeader({
  summary,
  tags,
}: {
  summary: ThemeSummary;
  tags: TagRef[];
}) {
  return (
    <header>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        {summary.name}
      </h1>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-quiet">
        {summary.nameIsReviewed ? null : (
          <span className="border border-rule px-2 py-0.5 font-medium text-ink">
            Suggested name
          </span>
        )}
        <span>
          {summary.sector ? SECTOR_LABELS[summary.sector] : "No sector yet"}
        </span>
        <span>
          {summary.companyCount === 1
            ? "1 company"
            : `${summary.companyCount} companies`}
        </span>
      </p>
      {tags.length > 0 ? (
        <div className="mt-3">
          <TagList tags={tags} />
        </div>
      ) : null}
    </header>
  );
}

function sum(points: readonly WeeklyPoint[]): number {
  return points.reduce((total, point) => total + point.rounds, 0);
}

/**
 * One sentence on the main change: the last 13 weeks against the 13 before.
 */
export function describeWeeklyChange(
  name: string,
  weekly: readonly WeeklyPoint[],
): string {
  const recent = weekly.slice(-13);
  const before = weekly.slice(-26, -13);
  const total = sum(weekly);
  if (total === 0) {
    return `No rounds in ${name} were recorded in the last 52 weeks.`;
  }
  const r = sum(recent);
  const b = sum(before);
  const plural = (n: number) => (n === 1 ? "1 round" : `${n} rounds`);
  const direction = r > b ? "up from" : r < b ? "down from" : "the same as";
  return `Rounds in ${name}: ${plural(r)} in the last 13 weeks, ${direction} ${plural(b)} in the 13 weeks before.`;
}
