"use strict";

/**
 * Test suite for keeper/retry.js
 *
 * Strategy: use Jest fake timers so backoff delays resolve instantly, and
 * mock `fn` (stand-in for sendChargeOnce) to simulate each failure class.
 * No network or testnet calls are made.
 */

const {
  withRetry,
  isRetryableError,
  isPermanentError,
  backoffMs,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  PERMANENT_PATTERNS,
  RETRYABLE_PATTERNS,
} = require("../retry");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an Error whose message matches a permanent contract failure. */
function permanentError(msg = "HostError: insufficient allowance") {
  return new Error(msg);
}

/** Build an Error whose message matches a transient RPC failure. */
function transientError(msg = "network timeout talking to RPC") {
  return new Error(msg);
}

/** Build an Error whose err.code matches a transient failure. */
function transientErrorByCode(code = "ETIMEDOUT") {
  const err = new Error("connection failed");
  err.code = code;
  return err;
}

/**
 * Return a mock fn that fails `failCount` times with `error`, then resolves
 * with `successValue`.
 */
function mockFn(failCount, error, successValue = { status: "SUCCESS" }) {
  let calls = 0;
  return jest.fn(async () => {
    calls += 1;
    if (calls <= failCount) throw error;
    return successValue;
  });
}

/**
 * Run withRetry with fake timers: advances all pending timers after each
 * backoff so the loop progresses without real wall-clock delay.
 *
 * Returns a promise that settles with { result } or { error }.
 */
async function runWithFakeTimers(fn, opts = {}) {
  jest.useFakeTimers();
  try {
    const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const promise = withRetry(fn, { baseDelayMs: 100, maxDelayMs: 1000, ...opts });
    // Each retry schedules one setTimeout. Drain microtasks then advance timers
    // for every possible backoff interval (maxAttempts - 1 retries at most),
    // with extra passes to flush chained microtasks after each timer fires.
    const passes = (maxAttempts - 1) * 4 + 4;
    for (let i = 0; i < passes; i++) {
      await Promise.resolve(); // flush microtasks
      jest.runAllTimers();     // resolve any pending setTimeout
    }
    const result = await promise;
    return { result };
  } catch (error) {
    return { error };
  } finally {
    jest.useRealTimers();
  }
}

// ---------------------------------------------------------------------------
// isPermanentError
// ---------------------------------------------------------------------------

describe("isPermanentError", () => {
  test.each([
    ["unauthorized access", true],
    ["HostError: Error(Contract, #2) insufficient allowance", true],
    ["HostError: not due yet", true],
    ["subscription is cancelled", true],
    ["subscription is canceled", true],
    ["already charged", true],
    ["invalid subscription id", true],
    ["UnreachableCodeReached", true],
    ["InvalidAction called", true],
    ["network timeout talking to RPC", false],
    ["ECONNRESET", false],
    ["fetch failed", false],
    ["TRY_AGAIN_LATER from RPC", false],
  ])('message "%s" → isPermanent=%s', (msg, expected) => {
    expect(isPermanentError(new Error(msg))).toBe(expected);
  });

  test("classifies via err.code as well as message", () => {
    // code alone won't match permanent patterns — should be retryable
    const err = new Error("something went wrong");
    err.code = "ETIMEDOUT";
    expect(isPermanentError(err)).toBe(false);
  });

  test("classifies via err.result JSON", () => {
    const err = new Error("contract call failed");
    err.result = { errorResultXdr: "HostError: insufficient allowance" };
    expect(isPermanentError(err)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe("isRetryableError", () => {
  test("permanent errors are NOT retryable", () => {
    expect(isRetryableError(permanentError())).toBe(false);
  });

  test.each([
    "network timeout talking to RPC",
    "fetch failed",
    "ECONNRESET",
    "502 bad gateway",
    "TRY_AGAIN later",
    "NOT_CONFIRMED",
    "temporarily unavailable",
  ])('transient message "%s" is retryable', (msg) => {
    expect(isRetryableError(new Error(msg))).toBe(true);
  });

  test("unknown error is treated as retryable (fail-safe)", () => {
    expect(isRetryableError(new Error("something totally unknown"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// backoffMs
// ---------------------------------------------------------------------------

describe("backoffMs", () => {
  test("first attempt returns baseDelayMs (± jitter)", () => {
    // attempt=1: exp = base * 2^0 = base
    const base = 500;
    const result = backoffMs(1, base, 8000);
    expect(result).toBeGreaterThanOrEqual(base);
    // jitter cap is Math.min(250, exp * 0.1) = 50 for base=500
    expect(result).toBeLessThanOrEqual(base + 50);
  });

  test("doubles on each attempt", () => {
    // With jitter=0 scenario: verify base * 2^(attempt-1) growth
    // We run many samples and check the minimum (no jitter case approaches base)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const expected = 100 * 2 ** (attempt - 1);
      const result = backoffMs(attempt, 100, 10000);
      expect(result).toBeGreaterThanOrEqual(expected);
    }
  });

  test("caps at maxDelayMs (ignoring jitter)", () => {
    // attempt=10 would give 500 * 2^9 = 256000 without cap
    const result = backoffMs(10, 500, 1000);
    // jitter cap = Math.min(250, 1000 * 0.1) = 100
    expect(result).toBeLessThanOrEqual(1000 + 100);
  });

  test("jitter is non-negative", () => {
    for (let i = 0; i < 20; i++) {
      expect(backoffMs(1, 500, 8000)).toBeGreaterThanOrEqual(500);
    }
  });
});

// ---------------------------------------------------------------------------
// withRetry — success on first attempt
// ---------------------------------------------------------------------------

describe("withRetry — immediate success", () => {
  test("returns result without retrying", async () => {
    const fn = jest.fn().mockResolvedValue({ status: "SUCCESS", hash: "abc" });
    const { result } = await runWithFakeTimers(fn, { maxAttempts: 3 });
    expect(result).toEqual({ status: "SUCCESS", hash: "abc" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// withRetry — transient failures then success
// ---------------------------------------------------------------------------

describe("withRetry — transient failure then success", () => {
  test("retries and succeeds within maxAttempts", async () => {
    const err = transientError();
    const fn = mockFn(2, err, { status: "SUCCESS", hash: "xyz" });
    const { result } = await runWithFakeTimers(fn, { maxAttempts: 3 });
    expect(result).toEqual({ status: "SUCCESS", hash: "xyz" });
    expect(fn).toHaveBeenCalledTimes(3); // 2 failures + 1 success
  });

  test("retries exactly once when only one failure", async () => {
    const fn = mockFn(1, transientError());
    const { result } = await runWithFakeTimers(fn, { maxAttempts: 3 });
    expect(result).toEqual({ status: "SUCCESS" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("succeeds on attempt 1 of 1 with no failures", async () => {
    const fn = mockFn(0, null);
    const { result } = await runWithFakeTimers(fn, { maxAttempts: 1 });
    expect(result).toEqual({ status: "SUCCESS" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// withRetry — permanent failure: no retry
// ---------------------------------------------------------------------------

describe("withRetry — permanent failure", () => {
  test("does not retry on permanent error, throws immediately", async () => {
    const err = permanentError("HostError: insufficient allowance");
    const fn = jest.fn().mockRejectedValue(err);
    const { error } = await runWithFakeTimers(fn, { maxAttempts: 3 });
    expect(error).toBe(err);
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  test.each([
    "unauthorized",
    "subscription is cancelled",
    "not due",
    "invalid subscription",
    "already charged",
  ])('permanent message "%s" is not retried', async (msg) => {
    const err = new Error(msg);
    const fn = jest.fn().mockRejectedValue(err);
    const { error } = await runWithFakeTimers(fn, { maxAttempts: 3 });
    expect(error).toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// withRetry — retry exhaustion
// ---------------------------------------------------------------------------

describe("withRetry — retry exhaustion", () => {
  test("gives up after maxAttempts and surfaces the last error", async () => {
    const err = transientError("fetch failed every time");
    const fn = jest.fn().mockRejectedValue(err);
    const { error } = await runWithFakeTimers(fn, { maxAttempts: 3 });
    expect(error).toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("respects a maxAttempts of 1 (no retry at all)", async () => {
    const err = transientError();
    const fn = jest.fn().mockRejectedValue(err);
    const { error } = await runWithFakeTimers(fn, { maxAttempts: 1 });
    expect(error).toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("respects a maxAttempts of 5", async () => {
    const err = transientError();
    const fn = jest.fn().mockRejectedValue(err);
    const { error } = await runWithFakeTimers(fn, { maxAttempts: 5 });
    expect(error).toBe(err);
    expect(fn).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// withRetry — already-SUCCESS short-circuit via custom shouldRetry
// ---------------------------------------------------------------------------

describe("withRetry — already-SUCCESS short-circuit", () => {
  test("shouldRetry returning false stops retrying immediately", async () => {
    const priorHash = "ALREADY_LANDED";
    const err = new Error("NOT_CONFIRMED");
    err.hash = priorHash;

    const fn = jest.fn().mockRejectedValue(err);

    // Simulate the keeper's guard: if hash already succeeded, do not retry
    const shouldRetry = jest.fn(async (e) => {
      if (e.hash === priorHash) return false; // already on-chain
      return true;
    });

    const { error } = await runWithFakeTimers(fn, {
      maxAttempts: 3,
      shouldRetry,
    });

    expect(error).toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);        // sent once
    expect(shouldRetry).toHaveBeenCalledTimes(1); // checked once, returned false
  });

  test("shouldRetry is not called on the final attempt", async () => {
    const err = transientError();
    const fn = jest.fn().mockRejectedValue(err);
    const shouldRetry = jest.fn().mockResolvedValue(true);

    await runWithFakeTimers(fn, { maxAttempts: 3, shouldRetry });

    // Called for attempts 1 and 2 only — attempt 3 is last so withRetry
    // skips the check and gives up.
    expect(shouldRetry).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// withRetry — backoff timing (fake timers)
// ---------------------------------------------------------------------------

describe("withRetry — backoff timing", () => {
  test("delays between retries (timers are advanced by fake timer)", async () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(global, "setTimeout");

    const err = transientError();
    const fn = mockFn(2, err);

    const promise = withRetry(fn, {
      baseDelayMs: 200,
      maxDelayMs: 5000,
      maxAttempts: 3,
    });

    // Drain the loop
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      jest.runAllTimers();
    }

    await promise;

    // Two failures → two backoff delays → setTimeout called at least twice
    // (retry.js also uses it internally via delay())
    const backoffCalls = spy.mock.calls.filter(([, ms]) => ms >= 200);
    expect(backoffCalls.length).toBeGreaterThanOrEqual(2);

    spy.mockRestore();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// withRetry — DEFAULT_MAX_ATTEMPTS constant
// ---------------------------------------------------------------------------

describe("withRetry — default constants", () => {
  test("DEFAULT_MAX_ATTEMPTS is 3", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  test("uses DEFAULT_MAX_ATTEMPTS when maxAttempts not provided", async () => {
    const err = transientError();
    const fn = jest.fn().mockRejectedValue(err);
    // No maxAttempts in opts — should default to 3
    const { error } = await runWithFakeTimers(fn, {});
    expect(error).toBe(err);
    expect(fn).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });
});
