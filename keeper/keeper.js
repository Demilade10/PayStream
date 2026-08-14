const {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  nativeToScVal,
  BASE_FEE,
} = require("@stellar/stellar-sdk");

const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = "CCIL5WPQB4KGYD5ITC5TKSQEI7V7L4CQM623TNF6GSKNR44H3CI2OTSR";
const KEEPER_SECRET = process.env.KEEPER_SECRET_KEY;
const SUBSCRIPTION_IDS = [0, 1, 2]; // v1: hardcoded, replace with real IDs

const server = new SorobanRpc.Server(RPC_URL);
const keeperKeypair = Keypair.fromSecret(KEEPER_SECRET);
const contract = new Contract(CONTRACT_ID);

async function chargeSubscription(subId) {
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

  try {
    const result = await server.sendTransaction(prepared);
    console.log(`Charged subscription ${subId}: ${result.status}`);
  } catch (err) {
    console.log(`Skipped subscription ${subId}: ${err.message}`);
  }
}

async function run() {
  for (const subId of SUBSCRIPTION_IDS) {
    await chargeSubscription(subId);
  }
}

run();
