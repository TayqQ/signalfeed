import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Amount } from "./amount";
import { Button } from "./button";
import { Chip, FilterChip } from "./chip";
import { ConfirmedMark } from "./confirmed-mark";
import { EmptyState } from "./empty-state";
import { Monogram, monogramLetters, monogramTint } from "./monogram";
import { NewMark } from "./new-mark";
import { PlaceBadge } from "./place-badge";
import { RankedBars } from "./ranked-bars";
import { RelativeDate, relativeDateLabel } from "./relative-date";
import { SectorLabel } from "./sector-label";
import { StageChip } from "./stage-chip";
import { Stat } from "./stat";

describe("Amount", () => {
  it("shows GBP first with the original currency beneath when it differs", () => {
    render(
      <Amount
        amount={{ amountMinor: 1_000_000_000, currency: "USD" }}
        amountGbpMinor={790_000_000}
      />,
    );
    expect(screen.getByText("£7.9m")).toBeInTheDocument();
    expect(screen.getByText("US$10.0m")).toBeInTheDocument();
  });

  it("shows one figure for GBP", () => {
    render(
      <Amount
        amount={{ amountMinor: 250_000_00, currency: "GBP" }}
        amountGbpMinor={250_000_00}
      />,
    );
    expect(screen.getByText("£250k")).toBeInTheDocument();
  });

  it("falls back to the original amount when there is no GBP value", () => {
    render(
      <Amount
        amount={{ amountMinor: 95_000_00, currency: "EUR" }}
        amountGbpMinor={null}
      />,
    );
    expect(screen.getByText("€95k")).toBeInTheDocument();
  });

  it("says Undisclosed when there is no amount", () => {
    render(<Amount amount={null} amountGbpMinor={null} size="lg" />);
    expect(screen.getByText("Undisclosed")).toBeInTheDocument();
  });
});

describe("StageChip", () => {
  it("always shows the stage as text", () => {
    render(<StageChip roundType="series_a" />);
    const chip = screen.getByText("Series A");
    expect(chip.closest("[data-stage]")).toHaveAttribute(
      "data-stage",
      "venture",
    );
  });

  it("shows a custom label but keeps the colour bucket", () => {
    render(<StageChip roundType="series_d_plus" label="Series F" />);
    const chip = screen.getByText("Series F").closest("[data-stage]");
    expect(chip).toHaveAttribute("data-stage", "late");
  });

  it("hides the marker from assistive technology", () => {
    const { container } = render(<StageChip roundType="seed" />);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(container).toHaveTextContent("Seed");
  });
});

describe("ConfirmedMark", () => {
  const text = "Confirmed: shares allotted on 2 February 2026 (SH01)";

  it("shows the word Confirmed and uses the text as name and title", () => {
    render(<ConfirmedMark text={text} />);
    const mark = screen.getByRole("note", { name: text });
    expect(mark).toHaveTextContent("Confirmed");
    expect(mark).toHaveAttribute("title", text);
  });
});

describe("PlaceBadge", () => {
  it("shows the country code and city", () => {
    render(<PlaceBadge countryCode="gb" city="Leeds" />);
    expect(screen.getByText("GB")).toBeInTheDocument();
    expect(screen.getByText("Leeds")).toBeInTheDocument();
  });

  it("shows only what is known", () => {
    render(<PlaceBadge countryCode="IE" city={null} />);
    expect(screen.getByText("IE")).toBeInTheDocument();
    expect(screen.queryByText("Place not known")).toBeNull();
  });

  it("says Place not known when nothing is known", () => {
    render(<PlaceBadge countryCode={null} city={null} />);
    expect(screen.getByText("Place not known")).toBeInTheDocument();
  });
});

describe("SectorLabel", () => {
  it("shows the sector label", () => {
    render(<SectorLabel sector="climate-energy" />);
    expect(screen.getByText("Climate and energy")).toBeInTheDocument();
  });

  it("says Sector pending for null or an unknown key", () => {
    const { rerender } = render(<SectorLabel sector={null} />);
    expect(screen.getByText("Sector pending")).toBeInTheDocument();
    rerender(<SectorLabel sector="not-a-sector" />);
    expect(screen.getByText("Sector pending")).toBeInTheDocument();
  });
});

describe("RelativeDate", () => {
  const now = new Date("2026-11-18T15:30:00Z");

  it.each([
    ["2026-11-18", "Today"],
    ["2026-11-17", "Yesterday"],
    ["2026-11-14", "4 days ago"],
    ["2026-11-04", "14 days ago"],
    ["2026-11-03", "3 Nov 2026"],
    ["2026-11-19", "19 Nov 2026"],
  ])("%s reads %s", (date, label) => {
    expect(relativeDateLabel(date, now)).toBe(label);
  });

  it("puts the exact date in the title and datetime", () => {
    render(<RelativeDate date="2026-11-14" now={now} />);
    const el = screen.getByText("4 days ago");
    expect(el).toHaveAttribute("title", "14 Nov 2026");
    expect(el).toHaveAttribute("datetime", "2026-11-14");
  });
});

describe("NewMark", () => {
  const now = new Date("2026-11-18T09:00:00Z");

  it("shows New for rounds within 2 days", () => {
    const { rerender } = render(<NewMark date="2026-11-16" now={now} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    rerender(<NewMark date="2026-11-18" now={now} />);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("shows nothing after 2 days", () => {
    const { container } = render(<NewMark date="2026-11-15" now={now} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Monogram", () => {
  it("uses one or two letters and is hidden from assistive technology", () => {
    expect(monogramLetters("Acme Robotics Ltd")).toBe("AR");
    expect(monogramLetters("monzo")).toBe("M");
    expect(monogramLetters("")).toBe("?");
    const { container } = render(<Monogram name="Acme Robotics" size={40} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container).toHaveTextContent("AR");
  });

  it("picks a stable tint from 1 to 8", () => {
    expect(monogramTint("Acme")).toBe(monogramTint("Acme"));
    for (const n of ["Acme", "Zed", "Ångström Ltd", "x"]) {
      expect(monogramTint(n)).toBeGreaterThanOrEqual(1);
      expect(monogramTint(n)).toBeLessThanOrEqual(8);
    }
  });
});

describe("Chip and FilterChip", () => {
  it("renders a static chip", () => {
    render(<Chip>Fintech</Chip>);
    expect(screen.getByText("Fintech")).toBeInTheDocument();
  });

  it("renders a removable filter as a link that removes the value", () => {
    render(<FilterChip label="Seed" removeHref="/?sector=ai" />);
    const link = screen.getByRole("link", { name: "Remove filter: Seed" });
    expect(link).toHaveAttribute("href", "/?sector=ai");
    expect(link).toHaveTextContent("Seed");
  });
});

describe("Button", () => {
  it("renders a button, or a link when given an href", () => {
    const { rerender } = render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute(
      "type",
      "button",
    );
    rerender(<Button href="/x">Go</Button>);
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute(
      "href",
      "/x",
    );
  });
});

describe("Stat", () => {
  it("shows label, value and sub-line", () => {
    render(<Stat label="Raised" value="£12M" sub="vs £9M before" />);
    expect(screen.getByText("Raised")).toBeInTheDocument();
    expect(screen.getByText("£12M")).toBeInTheDocument();
    expect(screen.getByText("vs £9M before")).toBeInTheDocument();
  });

  it("says Not known for a missing value", () => {
    render(<Stat label="Founded" value={null} />);
    expect(screen.getByText("Not known")).toBeInTheDocument();
  });
});

describe("RankedBars", () => {
  it("shows a text value per bar and scales to the largest", () => {
    render(
      <RankedBars
        items={[
          { label: "Software", value: 100, valueLabel: "£100M", href: "/?s=a" },
          { label: "Health", value: 25, valueLabel: "£25M" },
        ]}
      />,
    );
    expect(screen.getByText("£100M")).toBeInTheDocument();
    expect(screen.getByText("£25M")).toBeInTheDocument();
    const bars = screen.getAllByTestId("ranked-bar");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "25%" });
    expect(screen.getByRole("link", { name: /Software/ })).toHaveAttribute(
      "href",
      "/?s=a",
    );
  });

  it("says so when empty", () => {
    render(<RankedBars items={[]} />);
    expect(
      screen.getByText("Nothing to show for this window."),
    ).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows a title, a description and an action", () => {
    render(
      <EmptyState
        title="No Companies House match yet"
        action={<button type="button">Back</button>}
      >
        We have not matched this company.
      </EmptyState>,
    );
    expect(
      screen.getByText("No Companies House match yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("We have not matched this company."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
