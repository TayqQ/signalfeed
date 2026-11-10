import { chromium } from "@playwright/test";

// Usage: pnpm screenshots [base url] [company slug]. Needs `pnpm exec playwright install chromium`,
// or CHROMIUM_PATH pointing at a browser you already have.
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const company = process.argv[3] ?? "northwind-robotics";

const SHOTS = [
  { path: "/", file: "funding-table.png", width: 1280, height: 800 },
  {
    path: `/companies/${company}`,
    file: "company-page.png",
    width: 1280,
    height: 800,
  },
  { path: "/status", file: "status.png", width: 1280, height: 800 },
  { path: "/", file: "funding-table-mobile.png", width: 390, height: 844 },
];

async function main(): Promise<void> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  try {
    for (const shot of SHOTS) {
      const page = await browser.newPage({
        viewport: { width: shot.width, height: shot.height },
      });
      const response = await page.goto(`${base}${shot.path}`, {
        waitUntil: "networkidle",
      });
      if (!response?.ok()) {
        throw new Error(`${shot.path} returned ${response?.status()}`);
      }
      await page.screenshot({ path: `docs/images/${shot.file}` });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
