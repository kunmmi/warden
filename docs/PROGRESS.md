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
| 1. Fork + strip Robinhood code | Not started | — |
| 2. BSC chain config | Not started | — |
| 3. PancakeSwap v3 venue | Unblocked, not started | — (addresses + fee tiers verified 2026-08-04) |
| 4. BSC token list | Unblocked, not started | — (USDT decimals verified 2026-08-04) |
| 5. Rebrand sweep | Not started | — |
| 6. End-to-end verification | Not started | Steps 1–5 |

## Open verification items (blocking)

See [DECISIONS.md](DECISIONS.md#open-verification-items-must-clear-before-the-dependent-step-is-marked-done) for the authoritative list. As of this update, all four v0-blocking items are resolved. One item remains open, and only blocks Phase 2:
1. Kernel v3.1 factory address on BSC — bytecode presence confirmed on-chain, but contract identity not yet conclusively matched to the exact ZeroDev build. Blocks v1 start, not v0.

## Decisions made so far

See [DECISIONS.md](DECISIONS.md) for full log with sources. Summary: forking merrymen (D001), named Warden (D002), targeting BSC (D003), keeping the ZeroDev/Pimlico AA stack (D004, chain support verified — specific factory address still open), targeting PancakeSwap v3 (D005, addresses still open), USDT as base currency (D006, decimals still open), v0 scoped to paper-trading only with no wall (D007).

## How to update this file

After completing a roadmap step: flip its status to Done, note the date, and if it resolved an open verification item, move that item from DECISIONS.md's open list to its "already-verified" section with the confidence level and source. Do not mark a step Done while it still has an open verification item blocking it — that's exactly the kind of unverified-claim-shipped-as-fact this project's process exists to prevent.
