import type { AnalysisResult } from "./types.js";

export class GuardError extends Error {
  constructor(
    message: string,
    public readonly origin?: unknown,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

/**
 * Thrown when the analyze endpoint cannot be reached or returns an error.
 * Fail-closed: callers must treat this as "unsafe to sign".
 */
export class AnalyzeError extends GuardError {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string,
    origin?: unknown,
  ) {
    super(message, origin);
    this.name = "AnalyzeError";
  }
}

/** Thrown when policy evaluation rejects a transaction (from `prepare`). */
export class GuardBlockedError extends GuardError {
  constructor(
    message: string,
    public readonly analysis: AnalysisResult,
    public readonly blockingReasons: string[],
  ) {
    super(message);
    this.name = "GuardBlockedError";
  }
}
