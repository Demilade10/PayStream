# Paystream

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Soroban SDK: 27.0.3](https://img.shields.io/badge/Soroban%20SDK-27.0.3-blueviolet)

Non-custodial recurring subscription billing for the Stellar network, built on Soroban.

Paystream lets a merchant define a subscription plan and a subscriber opt in with a revocable, time-bound token allowance. Anyone (a "keeper") can then trigger a due charge — no centralized server, no custodial holding of funds.

## How it works

1. Merchant calls `create_plan` — defines price, billing interval, and token.
2. Subscriber calls the token contract's `approve` directly, granting Paystream's contract address an allowance (this step is separate from Paystream itself, by design — see Trust model).
3. Subscriber calls `subscribe` on Paystream, referencing the plan.
4. Anyone (a keeper bot) calls `charge` once a billing cycle is due — it can only ever pull what was pre-approved.
5. Subscriber can `cancel` anytime.

## Trust model

- Subscribers grant a capped, revocable allowance via the token contract's standard `approve` — Paystream never custodies funds.
- The `approve` step is done directly with the token contract, not routed through Paystream — this avoids a fragile nested cross-contract authorization pattern and is the standard, reliable approach.
- `charge()` is intentionally permissionless: any address can call it, but it can only ever move what the subscriber pre-approved, on schedule.
- `cancel()` requires the subscriber's own signature — no one else can cancel or modify a subscription on their behalf.

## Current limitations (v1)

- Flat recurring billing only — no usage-based/metered billing yet
- Single token per plan (no multi-token support yet)
- No plan editing after creation (`update_plan`, `deactivate_plan` not yet implemented)
- No pause/resume — only full cancellation
- Manual/keeper-triggered charges — no built-in incentive mechanism yet for keepers
- Subscriber must manually approve the token allowance before subscribing (not bundled into one transaction)

These are intentional v1 scope cuts, not oversights — see Roadmap below.

## Testnet deployment

- Contract: `CAGPAEHIEP7TOREAANS6CTYACQ6MCNVTKTBOQZIRFP3DVL3PC3DODSPJ`
- Native XLM token (SAC): `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

## Build & test
See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full local setup guide.
Requires Rust, the `wasm32v1-none` target, and the Stellar CLI.

**Windows note:** `cargo test` and `stellar contract build` require different `crate-type` values in `Cargo.toml` due to a MinGW linker symbol-count limit with `testutils`. Before testing:
```toml
crate-type = ["rlib"]
```
Before building the wasm binary:
```toml
crate-type = ["cdylib", "rlib"]
```

```bash
cargo test              # crate-type = ["rlib"]
stellar contract build  # crate-type = ["cdylib", "rlib"]
```

## Roadmap

**Trivial**
- Add `pause` / `resume` functions
- Add input validation (zero-price plans, invalid intervals)
- Add doc comments to public functions
- Add `get_merchant_plans(merchant)` helper view

**Medium**
- `update_plan` — allow merchant to change price/interval
- `deactivate_plan` — stop new subscriptions on an existing plan
- Emit contract events for `charge` / `cancel` / `subscribe`
- Grace period logic for failed charges
- Multi-token support per plan
- Combine `approve` + `subscribe` into a single guided flow for the subscriber (e.g. via a frontend or helper script)

**High**
- Usage-based/metered billing module
- Permissionless, incentivized keeper mechanism
- Subscription upgrade/downgrade with proration
- Oracle-based dispute/failure resolution path

## Contributing

Contributions are welcome. Paystream has a roadmap of ~40 tracked issues covering new contract features, testing, CI, and documentation — a good range of entry points for all experience levels.

- See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, branch naming, and commit conventions.
- Browse [good first issues](https://github.com/Demilade10/PayStream/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) to find something to pick up.

## License

MIT
