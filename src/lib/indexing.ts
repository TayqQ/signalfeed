import type { Metadata, MetadataRoute } from "next";
import { isSiteIndexingEnabled, type EnvSource } from "@/core/env";

/** The `robots` metadata for every page. Closed until `SITE_INDEXING` is "true". */
export function pageRobots(env: EnvSource): NonNullable<Metadata["robots"]> {
  return isSiteIndexingEnabled(env)
    ? { index: true, follow: true }
    : { index: false, follow: false };
}

/** The contents of `/robots.txt`. Disallows everything until `SITE_INDEXING` is "true". */
export function robotsFile(env: EnvSource): MetadataRoute.Robots {
  return isSiteIndexingEnabled(env)
    ? { rules: { userAgent: "*", allow: "/" } }
    : { rules: { userAgent: "*", disallow: "/" } };
}
