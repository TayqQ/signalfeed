import { beforeEach, describe, expect, it, vi } from "vitest";

const cachedCompanyPreview = vi.fn<(slug: string) => Promise<unknown>>();
vi.mock("@/lib/cached", () => ({
  cachedCompanyPreview: (slug: string) => cachedCompanyPreview(slug),
}));

const { GET } = await import("./route");

function call(slug: string) {
  return GET(new Request(`http://localhost/api/company-preview/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

describe("GET /api/company-preview/[slug]", () => {
  beforeEach(() => cachedCompanyPreview.mockReset());

  it("rejects a malformed slug before any query", async () => {
    const response = await call("../etc/passwd");
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cachedCompanyPreview).not.toHaveBeenCalled();
  });

  it("returns 404, cached briefly, for an unknown company", async () => {
    cachedCompanyPreview.mockResolvedValue(null);
    const response = await call("no-such-company");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=60");
    expect(cachedCompanyPreview).toHaveBeenCalledWith("no-such-company");
  });

  it("returns the preview as JSON with the edge cache header", async () => {
    const preview = { slug: "griffin", name: "Griffin" };
    cachedCompanyPreview.mockResolvedValue(preview);
    const response = await call("griffin");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    expect(await response.json()).toEqual(preview);
  });
});
