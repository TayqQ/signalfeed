import { cachedCompanyPreview } from "@/lib/cached";
import { isCompanySlug } from "@/lib/view-preference";

/** Five minutes fresh at the edge, then served stale for up to an hour while it refreshes. */
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";
/** A missing company is cached briefly, so a new one appears soon. */
const MISSING_CACHE_CONTROL = "public, s-maxage=60";

/**
 * GET /api/company-preview/<slug>: the split view's `CompanyPreview` as JSON,
 * read through the same cache as the server-rendered preview. 400 for a
 * malformed slug (checked before any query), 404 for an unknown company.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!isCompanySlug(slug)) {
    return Response.json(
      { error: "Invalid company slug" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const preview = await cachedCompanyPreview(slug);
  if (!preview) {
    return Response.json(
      { error: "Company not found" },
      { status: 404, headers: { "Cache-Control": MISSING_CACHE_CONTROL } },
    );
  }
  return Response.json(preview, {
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}
