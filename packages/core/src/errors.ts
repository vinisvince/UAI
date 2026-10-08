import type { ApiError } from "@uai/contracts";

export type UaiErrorCode = ApiError["error"];

const HTTP: Record<UaiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  invalid_input: 400,
  not_found: 404,
  consent_required: 403,
  rate_limited: 429,
  unavailable: 503,
};

/** Erreur exposable : code stable et message sans détail interne. */
export class UaiError extends Error {
  constructor(
    public readonly code: UaiErrorCode,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
  }
  get httpStatus(): number {
    return HTTP[this.code];
  }
  toJSON(): ApiError {
    return { error: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}
