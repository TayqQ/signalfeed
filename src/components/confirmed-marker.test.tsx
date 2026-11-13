import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmedMarker } from "./confirmed-marker";

const text =
  "Confirmed: shares allotted on 2 February 2026 (Companies House SH01)";

describe("ConfirmedMarker", () => {
  it("uses the confirmation text as its accessible name and title", () => {
    render(<ConfirmedMarker text={text} />);
    const marker = screen.getByRole("note", { name: text });
    expect(marker).toHaveAttribute("title", text);
    expect(marker).toHaveTextContent("Confirmed");
  });
});
