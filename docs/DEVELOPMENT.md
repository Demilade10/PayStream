\# Local Development Setup



This guide walks you from a fresh clone to a passing test suite and a successful contract build.



\## Prerequisites



\- \*\*Rust\*\* (via \[rustup](https://rustup.rs))

\- \*\*`wasm32v1-none` target\*\* — install with:

```bash

&#x20; rustup target add wasm32v1-none

```

\- \*\*Stellar CLI\*\* — install with:

```bash

&#x20; cargo install --locked stellar-cli

```



\## Getting started



```bash

git clone https://github.com/<your-fork>/PayStream.git

cd PayStream

```



\## The `soroban-sdk` version pin



`Cargo.toml` pins `soroban-sdk = "27.0.3"`. Do not bump this to `27.0.5` — that version is missing the `soroban-ledger-snapshot` crate on crates.io, and the build will fail. Stick to `27.0.3` until this is resolved upstream.



\## The crate-type distinction (Windows/MinGW)



`Cargo.toml`'s `\[lib]` section controls how the crate compiles, and the two workflows below need \*different\* values:



| Command | Required `crate-type` | Why |

|---|---|---|

| `cargo test` | `\["rlib"]` | `testutils` generates many exported symbols. On Windows/MinGW, `cdylib` output has a linker limit on exported symbols, and `testutils` blows past it, so `cdylib` must be dropped for tests to link. |

| `stellar contract build` | `\["cdylib", "rlib"]` | Only `cdylib` produces the `.wasm` binary the Stellar network actually deploys, so it's required for builds. |



Before running tests, set:

```toml

\[lib]

crate-type = \["rlib"]

```



Before building the contract, set:

```toml

\[lib]

crate-type = \["cdylib", "rlib"]

```



\## Running tests



```bash

cargo test

```

(with `crate-type = \["rlib"]` as above)



\## Building and deploying to testnet



```bash

stellar contract build

```

(with `crate-type = \["cdylib", "rlib"]` as above)



To deploy the built `.wasm` to testnet:

```bash

stellar contract deploy \\

&#x20; --wasm target/wasm32v1-none/release/paystream.wasm \\

&#x20; --source <your-identity> \\

&#x20; --network testnet

```



\## Troubleshooting



\- \*\*Linker errors mentioning too many exported symbols\*\* → you're running `cargo test` with `crate-type` still set to `\["cdylib", "rlib"]`. Switch it to `\["rlib"]`.

\- \*\*`stellar contract build` produces no `.wasm` / fails to find `cdylib` target\*\* → you're building with `crate-type` set to `\["rlib"]` only. Switch it back to `\["cdylib", "rlib"]`.

\- \*\*Dependency resolution fails on `soroban-ledger-snapshot`\*\* → check `Cargo.toml` still pins `soroban-sdk = "27.0.3"`, not `27.0.5`.

