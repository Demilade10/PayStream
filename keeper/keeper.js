const {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  nativeToScVal,
  BASE_FEE,
} = require("@stellar/stellar-sdk");
const { withRetry, isRetryableError, isPermanentError } = require("./retry");

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID =
  process.env.CONTRACT_ID ||
  "CCIL5WPQB4KGYD5ITC5TKSQEI7V7L4CQM623TNF6GSKNR44H3CI2OTSR";
const KEEPER_SECRET = process.env.KEEPER_SECRET_KEY;
const SUBSCRIPTION_IDS = (process.env.SUBSCRIPTION_IDS || "0,1,2")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

if (!KEEPER_SECRET) {
  console.error("KEEPER_SECRET_KEY is required");
  process.exit(1);
}

const server = new SorobanRpc.Server(RPC_URL);
const keeperKeypair = Keypair.fromSecret(KEEPER_SECRET);
const contract = new Contract(CONTRACT_ID);

/**
 * Look up a submitted transaction. Returns true only when the network has
 * confirmed SUCCESS — used to avoid retrying a charge that already settled.
 */
async function transactionSucceeded(hash) {
  if (!hash) return false;
  try {
    const tx = await server.getTransaction(hash);
    // sdk status enum: SUCCESS | NOT_FOUND | FAILED
    return tx && tx.status === "SUCCESS";
  } catch (err) {
    // Lookup failure is not proof of success; treat as "not confirmed".
    console.log(`tx lookup ${hash}: ${err.message}`);
    return false;
  }
}

async function sendChargeOnce(subId) {
  const account = await server.getAccount(keeperKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("charge", nativeToScVal(subId, { type: "u64" })))
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keeperKeypair);

  const result = await server.sendTransaction(prepared);
  const hash = result.hash || result.id;

  if (result.status === "ERROR" || result.status === "FAILED") {
    const err = new Error(
      `sendTransaction status=${result.status} for subscription ${subId}`
    );
    err.result = result;
    err.hash = hash;
    throw err;
  }

  // PENDING / TRY_AGAIN_LATER / DUPLICATE — wait for confirmation when we have a hash.
  if (hash) {
    // Brief poll: transient inclusion lag should not look like a failed charge.
    for (let i = 0; i < 5; i++) {
      if (await transactionSucceeded(hash)) {
        return { status: "SUCCESS", hash, subId };
      }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
    // Not confirmed yet — if the tx might still land, surface as retryable
    // only after we verified it has not succeeded.
    const err = new Error(
      `charge not confirmed for subscription ${subId} (hash=${hash})`
    );
    err.hash = hash;
    err.code = "NOT_CONFIRMED";
    throw err;
  }

  return { status: result.status, hash, subId };
}

async function chargeSubscription(subId) {
  try {
    const outcome = await withRetry(
      () => sendChargeOnce(subId),
      {
        maxAttempts: 3,
        label: `charge(sub=${subId})`,
        // Before a retry, ensure a prior submission did not already succeed.
        shouldRetry: async (err, attempt) => {
          if (isPermanentError(err)) {
            console.log(
              `permanent failure for subscription ${subId} (attempt ${attempt}): ${err.message}`
            );
            return false;
          }
          if (err && err.hash) {
            const done = await transactionSucceeded(err.hash);
            if (done) {
              console.log(
                `subscription ${subId}: prior tx ${err.hash} already SUCCESS — not retrying`
              );
              return false;
            }
          }
          if (!isRetryableError(err)) {
            console.log(
              `non-retryable failure for subscription ${subId} (attempt ${attempt}): ${err.message}`
            );
            return false;
          }
          console.log(
            `retryable failure for subscription ${subId} (attempt ${attempt}): ${err.message}`
          );
          return true;
        },
      }
    );
    console.log(
      `Charged subscription ${subId}: ${outcome.status}` +
        (outcome.hash ? ` hash=${outcome.hash}` : "")
    );
    return outcome;
  } catch (err) {
    console.log(`Skipped subscription ${subId}: ${err.message}`);
    return null;
  }
}

async function run() {
  for (const subId of SUBSCRIPTION_IDS) {
    await chargeSubscription(subId);
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  chargeSubscription,
  transactionSucceeded,
  sendChargeOnce,
  isRetryableError,
  isPermanentError,
};
