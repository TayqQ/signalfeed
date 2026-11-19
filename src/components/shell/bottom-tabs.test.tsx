import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomTabs } from "./bottom-tabs";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

describe("BottomTabs", () => {
  beforeEach(() => {
    pathname = "/";
  });

  it("is a second nav with four tabs and More, and marks the current tab", () => {
    pathname = "/investors/byfounders";
    render(<BottomTabs />);
    const nav = screen.getByRole("navigation", { name: "Main (mobile)" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Funding",
      "Investors",
      "Themes",
      "Trends",
    ]);
    expect(
      within(nav).getByRole("link", { name: "Investors" }),
    ).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens the More sheet and closes it with Close, Escape and the backdrop", () => {
    render(<BottomTabs />);
    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    fireEvent.click(more);

    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    for (const name of ["Acquisitions", "Status", "About", "Source code"]) {
      expect(within(sheet).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(sheet).getByRole("link", { name: "AGPL-3.0" })).toBeVisible();
    expect(
      within(sheet).getByRole("button", {
        name: /Switch to (dark|light) theme/,
      }),
    ).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(more).toHaveFocus();

    fireEvent.click(more);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(more);
    fireEvent.click(screen.getByTestId("more-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the sheet when a link in it is followed", () => {
    render(<BottomTabs />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const status = screen.getByRole("link", { name: "Status" });
    // jsdom cannot load another document; the sheet's own handler still runs.
    status.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(status);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows More as current on a page it holds", () => {
    pathname = "/acquisitions";
    render(<BottomTabs />);
    expect(screen.getByRole("button", { name: "More" })).toHaveClass(
      "bg-nav-active",
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("link", { name: "Acquisitions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
