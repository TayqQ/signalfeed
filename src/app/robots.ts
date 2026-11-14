import type { MetadataRoute } from "next";
import { robotsFile } from "@/lib/indexing";

export default function robots(): MetadataRoute.Robots {
  return robotsFile(process.env);
}
