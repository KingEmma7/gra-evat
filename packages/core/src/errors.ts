/** A validation failure with a precise path and an actionable correction. */
export interface ValidationIssue {
  readonly path: string;
  readonly expected: string;
  readonly received: unknown;
  readonly message: string;
  readonly hint: string;
}

/** All request problems collected during one validation pass.
 * @example
 * ```ts
 * import { ValidationError } from '@gra-evat/core';
 * const error = new ValidationError([{path:'flag',expected:'INVOICE',received:'invoice',message:'Wrong casing',hint:'Use INVOICE'}]);
 * console.log(error.issues[0]?.path);
 * ```
 */
export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}. ${issue.hint}`).join('\n'));
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/** An HTTP error or a successful HTTP response with an invalid API body.
 * @example
 * ```ts
 * import { GraApiError } from '@gra-evat/core';
 * const error = new GraApiError(403, 'forbidden', {status:901,error:'forbidden'});
 * console.log(error.status);
 * ```
 */
export class GraApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
    message = `GRA request failed (${status}): ${code}`,
  ) {
    super(message);
    this.name = 'GraApiError';
  }
}

/** A fetch failure after the configured retry budget is exhausted.
 * @example
 * ```ts
 * import { NetworkError } from '@gra-evat/core';
 * const error = new NetworkError('Service unreachable');
 * console.log(error.message);
 * ```
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The request exceeded its per-attempt timeout.
 * @example
 * ```ts
 * import { TimeoutError } from '@gra-evat/core';
 * const error = new TimeoutError(10000);
 * console.log(error.timeoutMs);
 * ```
 */
export class TimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`GRA request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export type GraError = ValidationError | GraApiError | NetworkError | TimeoutError;
export type Result<T, E = GraError> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: E };
