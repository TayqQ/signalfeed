import { unstable_cache } from "next/cache";

/** Ten minutes, matching the read cache in D18. */
const DEFAULT_REVALIDATE_SECONDS = 600;

/**
 * Cache a server read. `keyParts` must include every input the callback closes
 * over: Next.js keys `unstable_cache` from these parts, not from the closure.
 * Pages call this around query functions.
 */
export async function cached<T>(
  fn: () => Promise<T>,
  keyParts: readonly string[],
  options?: { revalidateSeconds?: number },
): Promise<T> {
  const revalidate = options?.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS;
  const read = unstable_cache(async () => fn(), [...keyParts], { revalidate });
  return read();
}
