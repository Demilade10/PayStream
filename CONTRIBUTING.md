# Contributing to Paystream

## Setup

For the full step-by-step guide, see [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).
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
- Reference the issue number in your PR description (`Closes #N`).

## Code style

Standard `rustfmt` formatting (`cargo fmt` before committing). Custom errors go through the `Error` enum in `lib.rs` — no raw `panic!`/`.expect()` in contract logic.

## Commit message convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`

Examples:
- `feat(keeper): add retry logic`
- `docs(dev): add setup guide`
- `test(core): add failure path tests`

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`

## Branch naming

Match the type/scope of the issue:

- `feat/keeper-retry-backoff`
- `test/keeper-retry-backoff-suite`
- `docs/architecture-flow`

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
