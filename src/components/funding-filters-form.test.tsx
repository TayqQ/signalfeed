import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FundingFiltersForm, PlaceSuggestions } from "./funding-filters-form";

describe("FundingFiltersForm place inputs", () => {
  const form = renderToStaticMarkup(
    <FundingFiltersForm
      filters={{ near: { placeSlug: "leeds", km: 25 }, page: 1, pageSize: 25 }}
    />,
  );

  const html = form;
  const list = renderToStaticMarkup(<PlaceSuggestions />);

  it("uses text inputs with labels for town and near", () => {
    expect(html).toMatch(/<input[^>]*id="city"[^>]*type="text"/);
    expect(html).toMatch(/<input[^>]*id="near"[^>]*type="text"/);
    expect(html).toContain('for="near"');
    expect(html).toContain("Type a UK town, e.g. Leeds");
    expect(html).not.toMatch(/<select[^>]*id="near"/);
  });

  it("shows the chosen place by name", () => {
    expect(html).toMatch(/id="near"[^>]*value="Leeds"/);
  });

  it("keeps the suggestion list short", () => {
    const suggestions = list.match(/<option /g) ?? [];
    expect(list).toContain('id="uk-place-suggestions"');
    expect(suggestions.length).toBeGreaterThan(40);
    expect(suggestions.length).toBeLessThan(120);
    expect(html).not.toContain("<datalist");
  });
});
