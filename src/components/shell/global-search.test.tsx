import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlobalSearch, isSearchShortcut, searchHref } from "./global-search";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function key(
  init: Partial<KeyboardEvent> & { key: string; target?: EventTarget | null },
) {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: document.body,
    ...init,
  };
}

describe("isSearchShortcut", () => {
  it('accepts "/", ⌘K and Ctrl+K', () => {
    expect(isSearchShortcut(key({ key: "/" }))).toBe(true);
    expect(isSearchShortcut(key({ key: "k", metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ key: "k", ctrlKey: true }))).toBe(true);
  });

  it("ignores plain k and modified slashes", () => {
    expect(isSearchShortcut(key({ key: "k" }))).toBe(false);
    expect(isSearchShortcut(key({ key: "/", ctrlKey: true }))).toBe(false);
  });

  it("ignores key presses in text fields, selects and editable content", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    for (const target of [input, textarea, select]) {
      expect(isSearchShortcut(key({ key: "/", target }))).toBe(false);
      expect(isSearchShortcut(key({ key: "k", metaKey: true, target }))).toBe(
        false,
      );
    }
  });

  it("still works from a checkbox or a button", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const button = document.createElement("button");
    expect(isSearchShortcut(key({ key: "/", target: checkbox }))).toBe(true);
    expect(isSearchShortcut(key({ key: "/", target: button }))).toBe(true);
  });
});

describe("GlobalSearch", () => {
  it("is a GET form to the funding list with q", () => {
    render(<GlobalSearch />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/");
    expect(form).toHaveAttribute("method", "get");
    expect(
      screen.getByRole("searchbox", { name: "Search companies and investors" }),
    ).toHaveAttribute("name", "q");
  });

  it('focuses on "/" and Ctrl+K from the page', () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("searchbox");
    fireEvent.keyDown(document.body, { key: "/" });
    expect(input).toHaveFocus();
    input.blur();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();
  });

  it("leaves a key press in another text field alone", () => {
    render(
      <>
        <GlobalSearch />
        <input aria-label="Other field" />
      </>,
    );
    const other = screen.getByRole("textbox", { name: "Other field" });
    other.focus();
    const notPrevented = fireEvent.keyDown(other, { key: "/" });
    expect(notPrevented).toBe(true);
    expect(other).toHaveFocus();
  });

  it("leaves the keyboard to an open dialog", () => {
    render(
      <>
        <GlobalSearch />
        <div role="dialog" aria-modal="true">
          <button type="button">Inside</button>
        </div>
      </>,
    );
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();
    fireEvent.keyDown(inside, { key: "/" });
    expect(inside).toHaveFocus();
  });
});

describe("searchHref", () => {
  it("keeps the funding list's filters and drops paging and the open preview", () => {
    expect(
      searchHref("/", "?sector=fintech&page=3&open=griffin", " Nor "),
    ).toBe("/?sector=fintech&q=Nor");
  });

  it("clears the term when the box is emptied", () => {
    expect(searchHref("/", "?q=old&round=seed", "")).toBe("/?round=seed");
  });

  it("starts a fresh search from other pages", () => {
    expect(searchHref("/investors", "?x=1", "Octagon")).toBe("/?q=Octagon");
    expect(searchHref("/trends", "", "")).toBe("/");
  });
});
