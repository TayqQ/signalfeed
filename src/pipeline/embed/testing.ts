import type {
  EmbeddingClient,
  EmbeddingRequest,
  EmbeddingResult,
} from "@/core/ports";

export interface FakeEmbeddingClientOptions {
  /** Fixed vectors for named inputs. Shorter than `dimensions` is zero-padded. */
  fixed?: Record<string, number[]>;
  model?: string;
}

export interface FakeEmbeddingClient extends EmbeddingClient {
  /** Every request received, in order. */
  readonly calls: EmbeddingRequest[];
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: a small, stable seeded generator. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalise(vector: number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return length === 0 ? vector : vector.map((v) => v / length);
}

function vectorFor(
  text: string,
  dimensions: number,
  fixed: Record<string, number[]>,
): number[] {
  const given = fixed[text];
  if (given) {
    if (given.length > dimensions) {
      throw new Error(
        `Fixed vector for "${text}" is longer than ${dimensions}`,
      );
    }
    return normalise([
      ...given,
      ...new Array<number>(dimensions - given.length).fill(0),
    ]);
  }
  const next = seeded(hashText(text));
  return normalise(Array.from({ length: dimensions }, () => next() * 2 - 1));
}

/** A deterministic `EmbeddingClient` for tests. Never touches the network. */
export function createFakeEmbeddingClient(
  options: FakeEmbeddingClientOptions = {},
): FakeEmbeddingClient {
  const { fixed = {}, model = "text-embedding-3-small" } = options;
  const calls: EmbeddingRequest[] = [];
  return {
    calls,
    embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      calls.push({
        inputs: [...request.inputs],
        dimensions: request.dimensions,
      });
      const characters = request.inputs.reduce((n, t) => n + t.length, 0);
      return Promise.resolve({
        vectors: request.inputs.map((text) =>
          vectorFor(text, request.dimensions, fixed),
        ),
        usage: { inputTokens: Math.ceil(characters / 4) },
        model,
      });
    },
  };
}
