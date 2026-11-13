import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — SignalFeed",
  description:
    "How SignalFeed collects startup news, extracts structured facts, and what we store.",
};

const GITHUB_ISSUES_URL = "https://github.com/TayqQ/signalfeed/issues";
const AGPL_URL = "https://www.gnu.org/licenses/agpl-3.0.en.html";
const LINK_CLASS =
  "font-medium text-blue-700 underline-offset-2 hover:underline";

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
          We do not keep records of individual people (founders, angels,
          officers) or any personal contact details. Headlines are shown as the
          publisher wrote them, so a headline may name someone.
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
            History starts when collection started. RSS feeds do not backfill
            years of archives, so older rounds are mostly missing. Grants are
            the one exception (see{" "}
            <a href="#grants" className={LINK_CLASS}>
              grants
            </a>
            ).
          </li>
        </ul>
      </section>

      <section id="themes" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">Themes and sectors</h2>
        <p className="mt-3 text-zinc-700">
          The model gives each company a few short tags, such as &ldquo;heat
          pumps&rdquo; or &ldquo;ai&rdquo;. Tags are noisy, so we group similar
          ones into themes. Each tag is turned into a numeric embedding. A tag
          joins an existing theme when it is close enough in meaning to it.
          Otherwise it starts a new theme. Very generic tags, such as
          &ldquo;startup&rdquo;, are ignored.
        </p>
        <p className="mt-3 text-zinc-700">
          A language model suggests each theme name once the theme has at least
          two companies. A person reviews names and can rename, merge or move
          tags. Until then, a name is only a suggestion and pages say so. Early
          themes can be too narrow, because the first tag seen sets the theme.
        </p>
        <p className="mt-3 text-zinc-700">
          A sector is one of a short fixed list, such as &ldquo;Health and life
          sciences&rdquo; or &ldquo;Climate and energy&rdquo;. Each theme has
          one sector, and a company takes the sectors of its themes. A company
          can therefore sit in more than one sector. Sectors are a broad filter.
          Themes are finer.
        </p>
        <p className="mt-3 text-zinc-700">
          Themes with fewer than three companies are listed on the themes page
          but left out of the trend views.
        </p>
      </section>

      <section id="rising-score" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">Rising score</h2>
        <p className="mt-3 text-zinc-700">
          The rising score shows whether a theme has had more funding rounds
          lately than its usual share. It counts rounds, not money, because one
          very large round would otherwise decide the result. Total funding is
          shown next to the score instead.
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-700">
          <li>
            <strong className="font-medium text-zinc-900">
              Recent window.
            </strong>{" "}
            The last 8 complete weeks. Weeks run Monday to Sunday, in UTC. The
            current week is never used.
          </li>
          <li>
            <strong className="font-medium text-zinc-900">
              Baseline window.
            </strong>{" "}
            Up to 26 weeks before that. It needs at least 8 weeks of collected
            history. Without that, the page says &ldquo;not enough history
            yet&rdquo; and shows no score.
          </li>
          <li>
            <strong className="font-medium text-zinc-900">Expected.</strong> We
            take the theme&rsquo;s share of all rounds in the baseline and apply
            it to all rounds in the recent window. If coverage grows, for
            example after a new feed, every theme is expected to grow with it.
          </li>
          <li>
            <strong className="font-medium text-zinc-900">Score.</strong> The
            score is the natural log of (recent + 3) divided by (expected + 3).
            The 3 (called α) acts like three imaginary rounds on each side. It
            stops a theme with one or two rounds from topping the list.
          </li>
        </ol>
        <p className="mt-3 text-zinc-700">
          A score of 0 means &ldquo;as expected&rdquo;. Above 0 is rising and
          below 0 is falling. Pages also show &ldquo;about 1.8× its usual
          share&rdquo;, which is the score turned back into a ratio.
        </p>
        <p className="mt-3 text-zinc-700">
          <strong className="font-medium text-zinc-900">Example.</strong> Across
          all themes there were 400 rounds in the recent window and 1,200 in the
          baseline. A theme had 6 recent rounds and 6 in the baseline. Expected
          is 6 × 400 ÷ 1,200 = 2. The score is ln(9 ÷ 5) = 0.59, or about 1.8×
          its usual share.
        </p>
        <p className="mt-3 text-zinc-700">
          Only themes with at least 3 recent rounds are listed. Grants are not
          counted in the score. The early-momentum list uses the same method on
          pre-seed and seed rounds only. It also needs a low share of companies
          that have gone on to Series A or later.
        </p>
        <p className="mt-3 text-zinc-700">
          The score is a guide, not a forecast. Counts are small, news coverage
          is uneven, and a few rounds can move it.
        </p>
      </section>

      <section id="momentum" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">Company momentum</h2>
        <p className="mt-3 text-zinc-700">
          Momentum is worked out for each company from its equity rounds only.
          Debt and grants are left out. Rounds are ordered by announcement date.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-700">
          <li>
            <strong className="font-medium text-zinc-900">
              First round means first recorded.
            </strong>{" "}
            &ldquo;First recorded round&rdquo; is the first round SignalFeed has
            seen. It is not necessarily the company&rsquo;s first ever, because
            our history starts when collection started.
          </li>
          <li>
            <strong className="font-medium text-zinc-900">
              Months since the last round.
            </strong>{" "}
            Whole calendar months from the previous equity round. It is blank
            when either date is known only to the year.
          </li>
          <li>
            <strong className="font-medium text-zinc-900">Step-up.</strong> The
            round&rsquo;s amount divided by the most recent earlier equity round
            that has an amount, if that round was within 36 months. It is blank
            when either amount is unknown. Amounts come from news and may be
            missing or rounded.
          </li>
          <li>
            <strong className="font-medium text-zinc-900">
              Rounds in the last 24 months.
            </strong>{" "}
            Counted against today&rsquo;s date.
          </li>
        </ul>
      </section>

      <section id="locations" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">
          Locations and &ldquo;near&rdquo;
        </h2>
        <p className="mt-3 text-zinc-700">
          UK regions use the ITL1 areas: the nine English regions, plus Wales,
          Scotland and Northern Ireland. A company&rsquo;s location comes from
          the first of these that applies:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-700">
          <li>
            The postcode district of its latest grant (for example
            &ldquo;L35&rdquo;), which is accurate to a few kilometres.
          </li>
          <li>
            A UK town or city named in the news. If a name could mean two
            places, we do not guess.
          </li>
          <li>A UK region named in the news, with no town.</li>
          <li>
            A city outside the UK. It can be matched by name but has no map
            position.
          </li>
        </ol>
        <p className="mt-3 text-zinc-700">
          &ldquo;Near a place&rdquo; measures straight-line distance from the
          centre of that place to the town or postcode district centre of each
          company. It can find Bradford or Harrogate near Leeds. It cannot do
          street-level distance. It cannot tell two companies in the same town
          apart. For a big city, the radius starts from the centre, so outer
          areas can be missed.
        </p>
        <p className="mt-3 text-zinc-700">
          Companies with only a region or only a country have no map position,
          so they drop out of distance searches. Most news companies have no
          town, because articles often do not give one. Treat distance results
          as a partial list, not a full one.
        </p>
      </section>

      <section id="grants" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">Grants</h2>
        <p className="mt-3 text-zinc-700">
          Innovate UK grants come from{" "}
          <a
            href="https://gtr.ukri.org/"
            className={LINK_CLASS}
            rel="noopener noreferrer"
          >
            UKRI Gateway to Research
          </a>
          . Source: UKRI Gateway to Research. Contains public sector information
          licensed under the Open Government Licence.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-700">
          <li>
            Grants are{" "}
            <strong className="font-medium text-zinc-900">
              hidden by default
            </strong>{" "}
            on the funding table. Choose the &ldquo;Grant&rdquo; round type to
            include them.
          </li>
          <li>
            We keep{" "}
            <strong className="font-medium text-zinc-900">
              organisations only
            </strong>
            : names that end in a company form such as Ltd or PLC, or that have
            a company number. Universities, councils and names that might be
            individuals are skipped. Some real companies without a company form
            in their name are missed too.
          </li>
          <li>
            The amount is the grant offer, not money paid out. The date is the
            project start month.
          </li>
          <li>
            Grants are not counted as funding rounds in the rising score or in
            company momentum. They are a different signal from venture rounds.
          </li>
          <li>
            Grants can be loaded back to an earlier date than the news, so grant
            history may reach further back. The source is updated about monthly.
          </li>
        </ul>
      </section>

      <section id="history" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">History starts when we did</h2>
        <p className="mt-3 text-zinc-700">
          News history starts when collection started. Trends, momentum and
          &ldquo;first recorded round&rdquo; all depend on it. Early scores are
          based on little data and will change as history builds up.
        </p>
      </section>

      <section id="geography-data" className="mt-10 scroll-mt-6">
        <h2 className="text-xl font-semibold">Geography data</h2>
        <p className="mt-3 text-zinc-700">
          Place and postcode district positions are built from open data.
          Contains OS data © Crown copyright and database right 2026. Contains
          Royal Mail data © Royal Mail copyright and database right 2026.
          Contains National Statistics data © Crown copyright and database right
          2026. Contains public sector information licensed under the Open
          Government Licence v3.0 (NISRA settlements). We have no Northern
          Ireland postcode positions, so those companies are located by town or
          region only.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">How quality is measured</h2>
        <p className="mt-3 text-zinc-700">
          Extraction is scored against hand-checked headlines, and merging
          against a hand-written set of hard cases. The method and results are
          in the{" "}
          <a
            href="https://github.com/TayqQ/signalfeed/tree/main/docs"
            className="font-medium text-blue-700 underline-offset-2 hover:underline"
            rel="noopener noreferrer"
          >
            project docs
          </a>
          .
        </p>
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
