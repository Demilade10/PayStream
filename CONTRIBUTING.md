# Contributing to Paystream

## Setup

1. Install Rust, `wasm32v1-none` target, and the Stellar CLI.
2. `git clone` this repo, then `cd paystream`.

**Windows note:** `Cargo.toml`'s `crate-type` must be `["rlib"]` for `cargo test` and `["cdylib", "rlib"]` for `stellar contract build`, due to a MinGW linker limit. Swap it depending on which command you're running.

## Running tests

```bash
cargo test
```

## Building the contract

```bash
stellar contract build
```

## Picking up an issue

- Comment on the issue to claim it before starting work.
- Keep PRs scoped to one issue.
- Include or update tests for any logic change.
- Reference the issue number in your PR description.

## Code style

Standard `rustfmt` formatting (`cargo fmt` before committing). Custom errors go through the `Error` enum in `lib.rs` — no raw `panic!`/`.expect()` in contract logic.
