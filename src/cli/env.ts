import { existsSync } from "node:fs";

/** Loads `.env` for local runs. GitHub Actions sets the variables itself. */
export function loadDotEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}
