import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

globalThis.fetch = () => {
  throw new Error(
    "Network access is disabled in tests; inject a fake HttpFetcher",
  );
};
