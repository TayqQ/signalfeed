import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const options = [
  { value: "list", label: "List" },
  { value: "cards", label: "Cards" },
  {
    value: "split",
    label: "Split",
    disabled: true,
    title: "Needs a wider screen",
  },
];

describe("SegmentedControl", () => {
  it("is a radio group with one checked option", () => {
    render(
      <SegmentedControl label="View" options={options} defaultValue="list" />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "View" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Cards" })).not.toBeChecked();
  });

  it("moves the selection with the arrow keys, skipping disabled options", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="View"
        options={options}
        defaultValue="list"
        onChange={onChange}
      />,
    );
    const list = screen.getByRole("radio", { name: "List" });
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Cards" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Cards" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("cards");

    // Split is disabled, so the next step wraps round to List.
    fireEvent.keyDown(screen.getByRole("radio", { name: "Cards" }), {
      key: "ArrowRight",
    });
    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();

    fireEvent.keyDown(screen.getByRole("radio", { name: "List" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("radio", { name: "Cards" })).toBeChecked();
  });

  it("has a single tab stop on the selected option", () => {
    render(
      <SegmentedControl label="View" options={options} defaultValue="cards" />,
    );
    expect(screen.getByRole("radio", { name: "Cards" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("explains a disabled option with its title", () => {
    render(
      <SegmentedControl label="View" options={options} defaultValue="list" />,
    );
    const split = screen.getByRole("radio", { name: "Split" });
    expect(split).toBeDisabled();
    expect(split).toHaveAttribute("title", "Needs a wider screen");
  });

  it("follows the value prop when controlled", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="View"
        options={options}
        value="list"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Cards" }));
    expect(onChange).toHaveBeenCalledWith("cards");
    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();
  });
});
