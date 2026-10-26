import { describe, expect, it } from "vitest";
import { syncFailure } from "./syncRecovery";
describe("shared synchronization failure policy", () => {
  it("retries rate limits and known service or persistence failures", () => {
    expect(syncFailure(429, false, false)).toMatchObject({
      retryable: true,
      retryAfterMs: 60000,
      closeCode: 1013,
    });
    expect(syncFailure(503, false, false)).toMatchObject({
      retryable: true,
      code: "temporarily_unavailable",
    });
    expect(syncFailure(undefined, true, false).retryable).toBe(true);
  });
  it("does not replay validation, unknown pre-persistence or authorization failures", () => {
    for (const status of [400, 401, 403, 409, 413, undefined])
      expect(syncFailure(status, false, false).retryable).toBe(false);
    expect(syncFailure(undefined, true, true)).toMatchObject({
      retryable: false,
      code: "forbidden",
      closeCode: 4004,
    });
    expect(syncFailure(401, false, false).closeCode).toBe(4001);
  });
});
