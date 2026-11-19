import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Chip, FilterChip } from "@/components/ui/chip";
import { ConfirmedMark } from "@/components/ui/confirmed-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { Monogram } from "@/components/ui/monogram";
import { NewMark } from "@/components/ui/new-mark";
import { PlaceBadge } from "@/components/ui/place-badge";
import { Popover } from "@/components/ui/popover";
import { RankedBars } from "@/components/ui/ranked-bars";
import { RelativeDate } from "@/components/ui/relative-date";
import { SectorLabel } from "@/components/ui/sector-label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sheet } from "@/components/ui/sheet";
import { StageChip } from "@/components/ui/stage-chip";
import { Stat } from "@/components/ui/stat";
import { ROUND_TYPES } from "@/core/enums";

export const metadata: Metadata = {
  title: "UI primitives",
  robots: { index: false, follow: false },
};

// A fixed "now" keeps the date examples stable.
const NOW = new Date("2026-11-18T12:00:00Z");

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-[var(--radius)] border border-line bg-surface p-4">
      <h2 className="mb-3 text-[17px] font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-28 shrink-0 text-xs text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

const LONG_NAME =
  "Northern Quantum Photonics and Advanced Materials Holdings Ltd";

export default function UiGalleryPage() {
  // Private reference page: not served in production.
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <main>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold">UI primitives</h1>
          <p className="mt-1 text-[15px] text-muted">
            Every component in every state. Private reference for the page
            tasks; not linked from the site.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Section title="Monogram">
          <Row label="Sizes">
            <Monogram name="Acme Robotics" size={24} />
            <Monogram name="Acme Robotics" size={28} />
            <Monogram name="Acme Robotics" size={40} />
            <Monogram name="Acme Robotics" size={56} />
          </Row>
          <Row label="Tints">
            {[
              "Acme",
              "Beam",
              "Cobalt",
              "Delta",
              "Ember",
              "Fjord",
              "Glint",
              "Halo",
            ].map((n) => (
              <Monogram key={n} name={n} size={40} />
            ))}
          </Row>
          <Row label="Odd names">
            <Monogram name="monzo" size={40} />
            <Monogram name="Ångström Labs" size={40} />
            <Monogram name="" size={40} />
          </Row>
        </Section>

        <Section title="Amount">
          <Row label="GBP, sm">
            <Amount
              amount={{ amountMinor: 250_000_00, currency: "GBP" }}
              amountGbpMinor={250_000_00}
            />
          </Row>
          <Row label="USD, sm">
            <Amount
              amount={{ amountMinor: 1_000_000_000, currency: "USD" }}
              amountGbpMinor={790_000_000}
            />
          </Row>
          <Row label="EUR, lg">
            <Amount
              amount={{ amountMinor: 4_250_000_000, currency: "EUR" }}
              amountGbpMinor={3_600_000_000}
              size="lg"
            />
          </Row>
          <Row label="No GBP value">
            <Amount
              amount={{ amountMinor: 95_000_00, currency: "EUR" }}
              amountGbpMinor={null}
            />
          </Row>
          <Row label="Undisclosed">
            <Amount amount={null} amountGbpMinor={null} />
            <Amount amount={null} amountGbpMinor={null} size="lg" />
          </Row>
        </Section>

        <Section title="StageChip">
          <Row label="Every type">
            {ROUND_TYPES.map((t) => (
              <StageChip key={t} roundType={t} />
            ))}
          </Row>
          <Row label="Custom label">
            <StageChip roundType="series_d_plus" label="Series F" />
            <StageChip roundType="growth" label="Growth equity" />
          </Row>
        </Section>

        <Section title="ConfirmedMark, NewMark">
          <Row label="Confirmed">
            <ConfirmedMark text="Confirmed: shares allotted on 2 February 2026 (Companies House SH01)" />
          </Row>
          <Row label="New">
            <NewMark date="2026-11-17" now={NOW} />
            <span className="text-xs text-muted">
              (hidden for older rounds)
            </span>
            <NewMark date="2026-11-01" now={NOW} />
          </Row>
        </Section>

        <Section title="PlaceBadge, SectorLabel">
          <Row label="Place">
            <PlaceBadge countryCode="GB" city="Leeds" />
          </Row>
          <Row label="Code only">
            <PlaceBadge countryCode="IE" city={null} />
          </Row>
          <Row label="City only">
            <PlaceBadge countryCode={null} city="Edinburgh" />
          </Row>
          <Row label="Long city">
            <div className="w-40">
              <PlaceBadge
                countryCode="GB"
                city="Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch"
              />
            </div>
          </Row>
          <Row label="Not known">
            <PlaceBadge countryCode={null} city={null} />
          </Row>
          <Row label="Sector">
            <SectorLabel sector="health-life-sciences" />
          </Row>
          <Row label="Pending">
            <SectorLabel sector={null} />
          </Row>
        </Section>

        <Section title="RelativeDate">
          <Row label="Today">
            <RelativeDate date="2026-11-18" now={NOW} />
          </Row>
          <Row label="Yesterday">
            <RelativeDate date="2026-11-17" now={NOW} />
          </Row>
          <Row label="4 days">
            <RelativeDate date="2026-11-14" now={NOW} />
          </Row>
          <Row label="14 days">
            <RelativeDate date="2026-11-04" now={NOW} />
          </Row>
          <Row label="15 days">
            <RelativeDate date="2026-11-03" now={NOW} />
          </Row>
        </Section>

        <Section title="Chip, FilterChip">
          <Row label="Chip">
            <Chip>Fintech</Chip>
            <Chip tone="brand">Selected</Chip>
          </Row>
          <Row label="FilterChip">
            <FilterChip label="Seed" removeHref="/ui" />
            <FilterChip label="UK only" removeHref="/ui" />
            <FilterChip label="£10m or more" removeHref="/ui" />
          </Row>
          <Row label="Long label">
            <Chip>{LONG_NAME}</Chip>
          </Row>
        </Section>

        <Section title="Surfaces and selection">
          <div className="rounded-[var(--radius)] bg-paper p-3 text-xs text-muted">
            paper
            <div className="mt-2 rounded-[var(--radius)] border border-line bg-surface p-3 text-ink">
              surface
              <div className="mt-2 rounded-[var(--radius)] border border-line bg-raised p-3 shadow-[var(--shadow-1)]">
                raised
                <div className="mt-2 rounded-[var(--radius)] border border-line bg-overlay p-3 shadow-[var(--shadow-2)]">
                  overlay
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-px overflow-hidden rounded-[var(--radius)] border border-line text-[13px]">
            <div className="bg-sel px-4 py-3 shadow-[inset_3px_0_0_var(--sel-bar)]">
              Selected row
            </div>
            <div className="bg-surface px-4 py-3">Unselected row</div>
          </div>
        </Section>

        <Section title="Button">
          <Row label="Primary">
            <Button variant="primary">Apply</Button>
            <Button variant="primary" size="sm">
              Apply
            </Button>
            <Button variant="accent">Add company</Button>
            <Button variant="accent" size="sm">
              Add
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </Row>
          <Row label="Secondary">
            <Button>Visit website</Button>
            <Button size="sm">Share</Button>
          </Row>
          <Row label="Ghost">
            <Button variant="ghost">Clear all</Button>
            <Button variant="ghost" size="sm">
              Clear all
            </Button>
          </Row>
          <Row label="As link">
            <Button href="/ui" variant="secondary" size="sm">
              Link button
            </Button>
          </Row>
        </Section>

        <Section title="SegmentedControl">
          <Row label="Stage">
            <SegmentedControl
              label="Stage"
              defaultValue="all"
              options={[
                { value: "all", label: "All" },
                { value: "seed", label: "Seed" },
                { value: "a", label: "Series A" },
                { value: "b", label: "Series B+" },
              ]}
            />
          </Row>
          <Row label="View, one off">
            <SegmentedControl
              label="View"
              defaultValue="list"
              options={[
                { value: "list", label: "List" },
                { value: "cards", label: "Cards" },
                {
                  value: "split",
                  label: "Split",
                  disabled: true,
                  title: "Split needs a screen at least 1100 px wide",
                },
              ]}
            />
          </Row>
        </Section>

        <Section title="Popover, Sheet">
          <Row label="Popover">
            <Popover triggerLabel="Amount" title="Amount presets">
              <p className="mb-2 text-[13px] text-muted">Show rounds of</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm">£1m+</Button>
                <Button size="sm">£10m+</Button>
                <Button size="sm">£50m+</Button>
              </div>
            </Popover>
          </Row>
          <Row label="Sheet">
            <Sheet triggerLabel="Filters" title="Filters">
              <p className="mb-3 text-[13px] text-muted">
                Choose what to show, then apply.
              </p>
              <Button variant="primary">Apply filters</Button>
            </Sheet>
          </Row>
        </Section>

        <Section title="Stat">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Raised" value="£412.0m" sub="up from £301.0m" />
            <Stat label="Rounds" value="186" sub="median £1.2m" />
            <Stat label="Founded" value={null} />
            <Stat label="Total raised" value="£12.4m" size="lg" />
          </div>
        </Section>

        <Section title="RankedBars">
          <RankedBars
            items={[
              {
                label: "Software, AI and data",
                value: 180,
                valueLabel: "£180.0m",
                href: "/ui",
              },
              {
                label: "Health and life sciences",
                value: 96,
                valueLabel: "£96.0m",
                href: "/ui",
              },
              { label: "Climate and energy", value: 41, valueLabel: "£41.0m" },
              { label: "Other", value: 1, valueLabel: "£1.0m" },
            ]}
          />
        </Section>

        <Section title="EmptyState">
          <EmptyState title="No Companies House match yet">
            We have not matched this company to an official record.
          </EmptyState>
          <EmptyState
            title="Website not found yet"
            action={<Button size="sm">Back to list</Button>}
          />
        </Section>

        <Section title="Long and missing values">
          <Row label="Long name">
            <div className="flex min-w-0 items-center gap-2">
              <Monogram name={LONG_NAME} size={28} />
              <span className="min-w-0 truncate">{LONG_NAME}</span>
            </div>
          </Row>
          <Row label="Everything missing">
            <Amount amount={null} amountGbpMinor={null} />
            <PlaceBadge countryCode={null} city={null} />
            <SectorLabel sector={null} />
          </Row>
        </Section>
      </div>
    </main>
  );
}
