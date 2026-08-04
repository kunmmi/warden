# Progress report

Last updated: 2026-08-04 (verification pass complete). Update this file whenever a roadmap step's status changes — it's the single source of truth for "where are we right now," so ROADMAP.md doesn't need editing just to reflect status.

## Snapshot

| Phase | Status |
|---|---|
| Phase 0 — Governance docs | Done (this batch) |
| Phase 1 — v0 paper-trading skeleton | Not started |
| Phase 2 — v1 trust layer | Not started |
| Phase 3 — later | Not scoped |

## Phase 1 detail

| Step | Status | Blocked on |
|---|---|---|
| 1. Fork + strip Robinhood code | Done (2026-08-04) | — |
| 2. BSC chain config | Done (2026-08-04) | — |
| 3. PancakeSwap v3 venue | Done (2026-08-04) — `worker/src/venues/pancakeswap-v3.ts`, wired into `pool-price.ts`/`discovery.ts` | — |
| 4. BSC token list | Done (2026-08-04) — WBNB/CAKE/BTCB/ETH, `TRADEABLE_SYMBOLS` fixed to match | — |
| 5. Rebrand sweep | Not started | — |
| 6. End-to-end verification | In progress | See "worker test suite" below |

Note: Steps 1-4 were substantially completed outside this doc's own tracking (discovered as pre-existing uncommitted work on 2026-08-04, reviewed and committed after verification — see commit `6df86b5`). All PancakeSwap addresses/fee tiers/USDT decimals in this work independently matched what's recorded in DECISIONS.md D005/D006 — cross-verified, not just trusted.

### Worker test suite status (2026-08-04)

`npx tsc --noEmit` clean on both `worker` and `web`. `npx tsx --test "worker/src/**/*.test.ts"`: **618/656 passing, 38 failing.**

Fixed so far (real bugs found in review, not cosmetic):
- `worker/src/venues/pool-prices.ts` hardcoded `cashDecimals: 6` (stale USDG figure) instead of `USDT_DECIMALS` (18) — silent trade-size corruption risk, same bug class flagged in VERIFICATION.md.
- `worker/src/chain.test.ts` asserted old Robinhood chain ids/explorer URLs against the new `chainForId`/`explorerFor` — stale test, now updated to assert BSC ids/URLs.
- `worker/src/wall.test.ts` local `usdg()` helper still computed 6dp amounts against the new 18dp USDT cap math; `packages/core/src/tokens.ts`'s `TRADEABLE_SYMBOLS`/`LEGACY_TRADEABLE_SYMBOLS`/`DEFAULT_BASKET_SYMBOLS` still listed old Robinhood stock tickers (AAPL, QQQ, NVDA...) with zero overlap with the new 4-token BSC list — both fixed.
- `worker/src/mcp.test.ts` and `worker/src/brokerage-store.integration.test.ts` imported the deleted `robinhood-oauth.ts`/`robinhood-id.ts` — the OAuth-specific test block was removed (no BSC equivalent exists yet, v0 has no auth path at all) and the brokerage-settlement integration test was deleted outright (Robinhood-brokerage-specific concept, no BSC equivalent, consistent with `rialto.test.ts`/`robinhood-feed.test.ts` already being deleted by the prior pass).

**Still failing, not yet fixed — same root cause, wider blast radius than initially visible**: `grant-coverage.test.ts`, `pool-price.test.ts`, `pool-prices.test.ts`, and basket/legs-selection tests (`legsForUniverse`, `watchTokensFor`, `sellableAssets`, `uncoveredBasketSymbols`, `mergeSettings`) all have fixtures hardcoding old stock symbols and/or 6dp USDG amounts. This is materially larger than a quick fixup — 38 failing tests across ~6 files. Flagged rather than silently ground through, per this project's own no-scope-creep rule.

## Open verification items (blocking)

See [DECISIONS.md](DECISIONS.md#open-verification-items-must-clear-before-the-dependent-step-is-marked-done) for the authoritative list. As of this update, all four v0-blocking items are resolved. One item remains open, and only blocks Phase 2:
1. Kernel v3.1 factory address on BSC — bytecode presence confirmed on-chain, but contract identity not yet conclusively matched to the exact ZeroDev build. Blocks v1 start, not v0.

## Decisions made so far

See [DECISIONS.md](DECISIONS.md) for full log with sources. Summary: forking merrymen (D001), named Warden (D002), targeting BSC (D003), keeping the ZeroDev/Pimlico AA stack (D004, chain support verified — specific factory address still open), targeting PancakeSwap v3 (D005, addresses still open), USDT as base currency (D006, decimals still open), v0 scoped to paper-trading only with no wall (D007).

## How to update this file

After completing a roadmap step: flip its status to Done, note the date, and if it resolved an open verification item, move that item from DECISIONS.md's open list to its "already-verified" section with the confidence level and source. Do not mark a step Done while it still has an open verification item blocking it — that's exactly the kind of unverified-claim-shipped-as-fact this project's process exists to prevent.
