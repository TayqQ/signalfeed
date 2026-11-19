import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RaisoryLogo } from "./raisory-logo";

describe("RaisoryLogo", () => {
  it("is an image named Raisory and takes a class", () => {
    render(<RaisoryLogo className="h-6 w-auto" />);
    const logo = screen.getByRole("img", { name: "Raisory" });
    expect(logo).toHaveClass("h-6", "w-auto");
    expect(logo).toHaveAttribute("viewBox", "0 -79.3 425.43 99.71");
  });

  it("colours the ring, dot and wordmark with theme variables", () => {
    const { container } = render(<RaisoryLogo />);
    expect(container.querySelector("path[stroke]")).toHaveAttribute(
      "stroke",
      "var(--logo-ring)",
    );
    expect(container.querySelector("circle")).toHaveAttribute(
      "fill",
      "var(--logo-dot)",
    );
    expect(container.querySelector("path[transform]")).toHaveAttribute(
      "fill",
      "var(--logo-ink)",
    );
  });
});
