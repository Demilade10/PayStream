/**
 * Retry helper with exponential backoff for keeper charge attempts.
 *
 * Distinguishes transient failures (RPC/network) from permanent contract
 * errors (Unauthorized, insufficient allowance, not due, cancelled) so we
 * never hammer a subscription that cannot succeed.
 */

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;

/** Contract / auth failures that will not succeed on retry. */
const PERMANENT_PATTERNS = [
  /unauthorized/i,
  /insufficient.?allowance/i,
  /not.?due/i,
  /cancelled|canceled/i,
  /already.?charged/i,
  /invalid.?subscription/i,
  /HostError/i,
  /UnreachableCodeReached/i,
  /InvalidAction/i,
];

/** Network / RPC blips worth retrying. */
const RETRYABLE_PATTERNS = [
  /timeout/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /network/i,
  /429/,
  /502/,
  /503/,
  /504/,
  /TRY_AGAIN/i,
  /NOT_CONFIRMED/i,
  /connection/i,
  /fetch failed/i,
  /temporarily unavailable/i,
];

function errorText(err) {
  if (!err) return "";
  const parts = [err.message, err.code, err.name];
  if (err.response && err.response.data) {
    parts.push(JSON.stringify(err.response.data));
  }
  if (err.result) {
    parts.push(JSON.stringify(err.result));
  }
  return parts.filter(Boolean).join(" ");
}

function isPermanentError(err) {
  const text = errorText(err);
  return PERMANENT_PATTERNS.some((re) => re.test(text));
}

function isRetryableError(err) {
  if (isPermanentError(err)) return false;
  const text = errorText(err);
  if (RETRYABLE_PATTERNS.some((re) => re.test(text))) return true;
  // Unknown errors: retry once-class — treat as retryable up to the cap so a
  // flaky RPC is not silently dropped. Permanent patterns above still win.
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt, baseDelayMs, maxDelayMs) {
  // attempt is 1-based for the failure that just happened
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.1));
  return exp + jitter;
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.baseDelayMs]
 * @param {number} [opts.maxDelayMs]
 * @param {string} [opts.label]
 * @param {(err: Error, attempt: number) => boolean | Promise<boolean>} [opts.shouldRetry]
 * @returns {Promise<T>}
 */
async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const label = opts.label || "operation";
  const shouldRetry = opts.shouldRetry || ((err) => isRetryableError(err));

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`${label}: succeeded on attempt ${attempt}/${maxAttempts}`);
      }
      return result;
    } catch (err) {
      lastErr = err;
      const retry =
        attempt < maxAttempts ? await shouldRetry(err, attempt) : false;
      console.log(
        `${label}: attempt ${attempt}/${maxAttempts} failed: ${err.message}` +
          (retry ? " — will retry" : " — giving up")
      );
      if (!retry) break;
      const wait = backoffMs(attempt, baseDelayMs, maxDelayMs);
      console.log(`${label}: backing off ${wait}ms before attempt ${attempt + 1}`);
      await delay(wait);
    }
  }
  throw lastErr;
}

module.exports = {
  withRetry,
  isRetryableError,
  isPermanentError,
  backoffMs,
  DEFAULT_MAX_ATTEMPTS,
  PERMANENT_PATTERNS,
  RETRYABLE_PATTERNS,
};
