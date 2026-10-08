import type { z } from "zod";
import type {
  CollectedItem,
  CostEstimate,
  FxRates,
  SourceConfig,
  UsageRecord,
} from "./domain";

export interface HttpGetOptions {
  headers?: Record<string, string>;
  /** Sent as `If-None-Match`. */
  etag?: string | null;
  /** Sent as `If-Modified-Since`. */
  lastModified?: string | null;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  body: string;
  etag: string | null;
  lastModified: string | null;
}

export interface HttpFetcher {
  get(url: string, options?: HttpGetOptions): Promise<HttpResponse>;
}

export interface LlmCompleteRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
}

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompleteResult<T> {
  data: T;
  usage: LlmTokenUsage;
  model: string;
}

export interface LlmClient {
  complete<T>(request: LlmCompleteRequest<T>): Promise<LlmCompleteResult<T>>;
}

export interface BudgetGuard {
  /** Throws `BudgetExceededError` or `UnknownModelPriceError` if the call must not happen. */
  assertCanSpend(estimate: CostEstimate): Promise<void>;
  record(usage: UsageRecord): Promise<void>;
  monthToDate(): Promise<{ spentUsdMicros: number; capUsdMicros: number }>;
}

export interface FxProvider {
  /** `date` is YYYY-MM-DD. */
  getRates(date: string): Promise<FxRates>;
}

export interface Clock {
  now(): Date;
}

export interface CollectorState {
  etag: string | null;
  lastModified: string | null;
}

export interface CollectResult {
  items: CollectedItem[];
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

export interface Collector {
  collect(source: SourceConfig, state: CollectorState): Promise<CollectResult>;
}
