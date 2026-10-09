import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — SignalFeed",
  description:
    "How SignalFeed collects startup news, extracts structured facts, and what we store.",
};

const GITHUB_ISSUES_URL = "https://github.com/TayqQ/signalfeed/issues";
const AGPL_URL = "https://www.gnu.org/licenses/agpl-3.0.en.html";

/** Phase 1 enabled RSS feeds (see `docs/sources.md`). */
const ENABLED_SOURCES = [
  {
    name: "TechCrunch Venture",
    url: "https://techcrunch.com/category/venture/feed/",
    attribution:
      "Headlines and links with attribution to TechCrunch and a link to each full article (RSS terms of use).",
  },
  {
    name: "Crunchbase News",
    url: "https://news.crunchbase.com/feed/",
    attribution:
      "Content attributed to Crunchbase with a link to the source article.",
  },
  {
    name: "Tech.eu",
    url: "https://tech.eu/feed/",
    attribution:
      "Headlines, links and feed summaries with clear source credit.",
  },
  {
    name: "EU-Startups",
    url: "https://www.eu-startups.com/feed/",
    attribution:
      "Headlines, links and feed summaries with clear source credit.",
  },
  {
    name: "UKTN",
    url: "https://www.uktech.news/feed/",
    attribution:
      "Headlines and links for non-commercial use; commercial redistribution needs UKTN consent.",
  },
] as const;

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-zinc-900">
      <h1 className="text-3xl font-semibold tracking-tight">
        About SignalFeed
      </h1>
      <p className="mt-4 text-lg text-zinc-700">
        SignalFeed collects public startup news from RSS feeds, uses a language
        model to extract structured facts (funding rounds, acquisitions,
        launches), merges duplicate reports into company and event records, and
        shows them on a read-only website. It is open source and designed to run
        at close to zero cost.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">How data flows</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-700">
          <li>
            <strong className="font-medium text-zinc-900">Collect.</strong>{" "}
            Scheduled jobs poll enabled RSS feeds and store new headlines, links
            and feed-provided summaries for processing.
          </li>
          <li>
            <strong className="font-medium text-zinc-900">Extract.</strong> A
            keyword prefilter selects relevant items; each passes through one
            LLM call that returns validated JSON (amounts stay as reported text
            and are parsed in code).
          </li>
          <li>
            <strong className="font-medium text-zinc-900">Merge.</strong> Entity
            resolution links extractions to companies, investors and events;
            ambiguous names go to a review queue rather than being guessed.
          </li>
        </ol>
        <p className="mt-3 text-zinc-700">
          Currency figures are normalised to USD and GBP using ECB reference
          rates. Ingestion runs on GitHub Actions; the public website is
          read-only and cannot trigger collection or LLM calls.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Sources</h2>
        <p className="mt-2 text-zinc-700">
          Phase 1 uses these verified RSS feeds. Sifted is disabled (no feed
          summary; terms conflict with LLM extraction).
        </p>
        <ul className="mt-4 space-y-4">
          {ENABLED_SOURCES.map((source) => (
            <li
              key={source.url}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"
            >
              <a
                href={source.url}
                className="font-medium text-blue-700 underline-offset-2 hover:underline"
                rel="noopener noreferrer"
              >
                {source.name}
              </a>
              <p className="mt-1 text-sm text-zinc-600">{source.attribution}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">What we store</h2>
        <p className="mt-3 text-zinc-700">
          We store headlines, links and extracted facts; we never republish
          article text. Feed summaries are kept only for LLM input and are not
          shown on the site.
        </p>
        <p className="mt-3 text-zinc-700">
          We do not store names of individual people (founders, angels,
          officers) or any personal contact details.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Limitations</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-700">
          <li>
            Coverage is news-based only: we see what publishers put in their
            feeds, not every deal worldwide.
          </li>
          <li>
            Automated extraction can misread headlines; amounts and dates are
            shown as reported and parsed, not independently verified.
          </li>
          <li>
            Historical depth starts on the first ingest date; RSS feeds do not
            backfill years of archives.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Report an error</h2>
        <p className="mt-3 text-zinc-700">
          Wrong merge, bad extraction or missing source? Please open an issue on
          GitHub with the headline link and what looks wrong:{" "}
          <a
            href={GITHUB_ISSUES_URL}
            className="font-medium text-blue-700 underline-offset-2 hover:underline"
            rel="noopener noreferrer"
          >
            {GITHUB_ISSUES_URL}
          </a>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Licence</h2>
        <p className="mt-3 text-zinc-700">
          SignalFeed is licensed under the{" "}
          <a
            href={AGPL_URL}
            className="font-medium text-blue-700 underline-offset-2 hover:underline"
            rel="noopener noreferrer"
          >
            GNU Affero General Public License v3.0 (AGPL-3.0)
          </a>
          . If you run a modified version as a service, you must offer
          corresponding source to users interacting with it over a network.
        </p>
      </section>
    </main>
  );
}
