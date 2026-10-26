/** Shared by Node and Durable Objects. Validation failures must not be retried. */
export function syncFailure(
  status: number | undefined,
  persistence: boolean,
  forbidden: boolean,
) {
  const retryable =
    !forbidden &&
    (status === 429 ||
      (status !== undefined && status >= 500) ||
      (status === undefined && persistence));
  return {
    code: forbidden
      ? "forbidden"
      : status === 401
        ? "authentication"
        : retryable
          ? status === 429
            ? "rate_limited"
            : "temporarily_unavailable"
          : "rejected",
    retryable,
    retryAfterMs: retryable ? (status === 429 ? 60_000 : 1000) : 0,
    closeCode: retryable
      ? 1013
      : forbidden
        ? 4004
        : status === 401
          ? 4001
          : 4002,
  };
}
