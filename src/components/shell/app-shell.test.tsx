import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/companies/x",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("AppShell", () => {
  it("starts with a skip link to the content", () => {
    const { container } = render(
      <AppShell>
        <p>Page</p>
      </AppShell>,
    );
    const first = container.querySelector("a, button, input");
    expect(first).toHaveTextContent("Skip to content");
    expect(first).toHaveAttribute("href", "#content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "content");
    expect(screen.getByRole("main")).toHaveTextContent("Page");
  });

  it("has the sidebar nav, the mobile nav and search, and no brief button", () => {
    render(
      <AppShell>
        <p>Page</p>
      </AppShell>,
    );
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).getByRole("link", { name: "Funding" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const name of ["Status", "About", "Source code", "AGPL-3.0"]) {
      expect(
        within(main).getAllByRole("link", { name }).length,
      ).toBeGreaterThan(0);
    }
    expect(
      screen.getByRole("navigation", { name: "Main (mobile)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
    // "Get the weekly brief" is gone until the brief exists.
    expect(screen.queryByRole("link", { name: /weekly brief/i })).toBeNull();
    expect(document.querySelector('a[href="/about#brief"]')).toBeNull();
  });
});
