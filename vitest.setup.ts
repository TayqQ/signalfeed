import "@testing-library/jest-dom/vitest";

globalThis.fetch = () => {
  throw new Error(
    "Network access is disabled in tests; inject a fake HttpFetcher",
  );
};
