export type ApiErrorBody = {
  error: string;
  code: string;
  details?: unknown;
};

export function apiError(code: string, error: string, details?: unknown): ApiErrorBody {
  return { error, code, ...(details !== undefined ? { details } : {}) };
}
