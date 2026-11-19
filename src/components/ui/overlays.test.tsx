import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Popover } from "./popover";
import { Sheet } from "./sheet";

describe("Sheet", () => {
  it("opens, moves focus inside, closes on Escape and returns focus to the trigger", () => {
    render(
      <Sheet triggerLabel="Filters" title="Filters">
        <button type="button">Apply</button>
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(screen.queryByRole("dialog")).toBeNull();
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on a backdrop click and with Close", () => {
    render(
      <Sheet triggerLabel="Filters" title="Filters">
        <p>Body</p>
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("sheet-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab inside the sheet", () => {
    render(
      <Sheet triggerLabel="Filters" title="Filters" defaultOpen>
        <button type="button">Apply</button>
      </Sheet>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const apply = screen.getByRole("button", { name: "Apply" });
    apply.focus();
    fireEvent.keyDown(apply, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(apply).toHaveFocus();
  });
});

describe("Popover", () => {
  it("toggles, closes on Escape and returns focus", () => {
    render(
      <Popover triggerLabel="Amount" title="Amount filter">
        <button type="button">£1m+</button>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Amount" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "£1m+" })).toHaveFocus();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on a click outside but not inside", () => {
    render(
      <div>
        <Popover triggerLabel="Amount" title="Amount filter">
          <p>Inside</p>
        </Popover>
        <p>Outside</p>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    fireEvent.mouseDown(screen.getByText("Inside"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
