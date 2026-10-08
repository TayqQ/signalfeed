export const ERROR_CODES = {
  budgetExceeded: "BUDGET_EXCEEDED",
  unknownModelPrice: "UNKNOWN_MODEL_PRICE",
  extractionValidation: "EXTRACTION_VALIDATION",
  config: "CONFIG",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export abstract class SignalFeedError extends Error {
  abstract readonly code: ErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface BudgetExceededDetails {
  model: string;
  estimateUsdMicros: number;
  spentUsdMicros: number;
  capUsdMicros: number;
}

export class BudgetExceededError extends SignalFeedError {
  readonly code = ERROR_CODES.budgetExceeded;
  readonly details: BudgetExceededDetails;

  constructor(details: BudgetExceededDetails) {
    super(
      `Monthly LLM budget exceeded: spent ${details.spentUsdMicros} + estimate ${details.estimateUsdMicros} > cap ${details.capUsdMicros} USD micros (model ${details.model})`,
    );
    this.details = details;
  }
}

export class UnknownModelPriceError extends SignalFeedError {
  readonly code = ERROR_CODES.unknownModelPrice;
  readonly model: string;

  constructor(model: string) {
    super(`No price is configured for model "${model}"; refusing the call`);
    this.model = model;
  }
}

export interface ValidationIssue {
  path: PropertyKey[];
  message: string;
}

export class ExtractionValidationError extends SignalFeedError {
  readonly code = ERROR_CODES.extractionValidation;
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], options?: ErrorOptions) {
    const summary = issues
      .map(
        (issue) =>
          `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
      )
      .join("; ");
    super(`Extraction failed validation: ${summary}`, options);
    this.issues = issues;
  }
}

export class ConfigError extends SignalFeedError {
  readonly code = ERROR_CODES.config;
  readonly missingKeys: readonly string[];
  readonly invalidKeys: readonly string[];

  constructor(
    missingKeys: readonly string[],
    invalidKeys: readonly string[] = [],
  ) {
    const parts: string[] = [];
    if (missingKeys.length > 0) {
      parts.push(`missing: ${missingKeys.join(", ")}`);
    }
    if (invalidKeys.length > 0) {
      parts.push(`invalid: ${invalidKeys.join(", ")}`);
    }
    super(`Invalid environment configuration (${parts.join("; ")})`);
    this.missingKeys = missingKeys;
    this.invalidKeys = invalidKeys;
  }
}
