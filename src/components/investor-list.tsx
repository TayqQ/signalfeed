import Link from "next/link";
import type { EventInvestor } from "@/core/read-models";

export function InvestorList({ investors }: { investors: EventInvestor[] }) {
  if (investors.length === 0) return null;
  const ordered = [...investors].sort(
    (a, b) => Number(b.role === "lead") - Number(a.role === "lead"),
  );
  return (
    <ul className="mt-1 text-sm">
      {ordered.map((investor) => (
        <li key={investor.slug}>
          <Link
            href={`/investors/${investor.slug}`}
            className="underline underline-offset-4 hover:text-signal"
          >
            {investor.name}
          </Link>
          {investor.role === "lead" ? (
            <span className="text-quiet"> (lead)</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
