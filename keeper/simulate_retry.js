/**
 * Simulated run log: transient failure recovers on retry; permanent is skipped.
 * Run: node simulate_retry.js
 */
const { withRetry, isRetryableError, isPermanentError } = require("./retry");

async function simulate() {
  console.log("=== simulate transient RPC failure then success ===");
  let n = 0;
  const ok = await withRetry(
    async () => {
      n += 1;
      if (n < 3) {
        const err = new Error("network timeout talking to RPC");
        err.code = "ETIMEDOUT";
        throw err;
      }
      return { status: "SUCCESS", hash: "SIMULATED_HASH" };
    },
    { maxAttempts: 3, label: "charge(sub=0)", baseDelayMs: 10, maxDelayMs: 20 }
  );
  console.log("result:", ok);

  console.log("\n=== simulate permanent insufficient allowance ===");
  try {
    await withRetry(
      async () => {
        const err = new Error("HostError: Error(Contract, #2) insufficient allowance");
        throw err;
      },
      {
        maxAttempts: 3,
        label: "charge(sub=1)",
        baseDelayMs: 10,
        maxDelayMs: 20,
        shouldRetry: async (err, attempt) => {
          if (isPermanentError(err)) {
            console.log(`permanent (attempt ${attempt}): ${err.message}`);
            return false;
          }
          return isRetryableError(err);
        },
      }
    );
  } catch (err) {
    console.log("gave up:", err.message);
  }

  console.log("\n=== simulate prior tx already SUCCESS (no double-charge) ===");
  let sends = 0;
  const priorHash = "ALREADY_LANDED";
  try {
    await withRetry(
      async () => {
        sends += 1;
        const err = new Error("charge not confirmed");
        err.hash = priorHash;
        err.code = "NOT_CONFIRMED";
        throw err;
      },
      {
        maxAttempts: 3,
        label: "charge(sub=2)",
        baseDelayMs: 10,
        maxDelayMs: 20,
        shouldRetry: async (err) => {
          // Pretend chain lookup found SUCCESS
          if (err.hash === priorHash) {
            console.log(`prior tx ${err.hash} already SUCCESS — not retrying`);
            return false;
          }
          return isRetryableError(err);
        },
      }
    );
  } catch (err) {
    console.log("gave up after sends=", sends, "err=", err.message);
  }
}

simulate().catch((e) => {
  console.error(e);
  process.exit(1);
});
