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
| 5. Rebrand sweep | Substantially done for the running app (package/env/home-dir, install scripts, CLI, core dashboard); site/ marketing copy, desktop/, gateway/ internals, mobile/ persona strings not yet touched — see below | — |
| 6. End-to-end verification | Worker test suite fully green (643/643); web dashboard Robinhood references cleaned up | Manual boot-and-click-through still not done |

### Rebrand sweep detail (2026-08-04/05)

Done:
- `@merrymen/*` → `@warden/*` package/import alias (28 files + every workspace package.json + every tsconfig.json path mapping)
- Root `package.json`: name, bin, version reset to 0.1.0, description, homepage/repository/bugs → explicit TODO placeholders (no real org/domain exists yet — not invented)
- `~/.merrymen` → `~/.warden` home directory, `MERRYMEN_HOME` → `WARDEN_HOME`, `merrymen.db` → `warden.db`
- All 70+ `MERRYMEN_*` env vars → `WARDEN_*`
- `install.sh` / `install.ps1`: package name, CLI command, banner text (dropped the archer/"stand and deliver" flavor), GitHub URLs → TODO placeholders
- `cli/bin.mjs`'s LLM provider table entry renamed/de-gated (see below)
- **A real bug found and fixed, not just a rename**: the token-gated "Merry Circle" tier system (fee discounts + bonus strategies for holders of a token) was deleted entirely — no BSC token exists for Warden, and the earlier mechanical env-var rename had left a constant named `WARDEN_TOKEN` still pointing at merrymen's own live token contract on Robinhood Chain (0xa15cd06d..., chain 4663). Confirmed with the user before removing (a product decision) rather than silently choosing rename-vs-delete. `even-keel`/`dip-hunter` strategies themselves survived as ordinary builtins — only the holder-gating around them was removed. Full detail in commit `93e9406`.
- Core dashboard (`web/src/app/page.tsx`): "Robinhood Chain · 4663" pill → "BSC · 56", "merrymen" brand text → "warden", dead `MerryCirclePanel` import removed.

**Not yet done** (explicitly out of scope for this pass, not forgotten):
- `site/` — the actual marketing site (930+ lines across page.tsx/token/governance/memescope/watch pages). This is a large, bespoke content/design rewrite, not a mechanical rename — deserves its own dedicated pass, similar to how the Twitter persona work was handled separately.
- `desktop/`, `gateway/` internals — the gateway is third-party-style hosted infrastructure Warden doesn't operate (see `packages/core/src/gateway.ts`'s TODO); desktop app packaging not yet touched.
- `mobile/` — persona/display strings (not the functional `@warden/core` imports, already renamed) not yet swept.
- Deeper CLI narrative flavor in `cli/bin.mjs` beyond the provider table (e.g. "the band," "the tavern," "muster") — left as-is pending a decision on whether Warden keeps *a* narrative voice or goes fully plain, per the original Step 5 planning note.
- `README.md` full content pass (currently still describes the merrymen product, not Warden).

Note: Steps 1-4 were substantially completed outside this doc's own tracking (discovered as pre-existing uncommitted work on 2026-08-04, reviewed and committed after verification — see commit `6df86b5`). All PancakeSwap addresses/fee tiers/USDT decimals in this work independently matched what's recorded in DECISIONS.md D005/D006 — cross-verified, not just trusted.

### Worker test suite status (2026-08-04)

`npx tsc --noEmit` clean on both `worker` and `web`. `npx tsx --test "worker/src/**/*.test.ts"`: **618/656 passing, 38 failing.**

Fixed so far (real bugs found in review, not cosmetic):
- `worker/src/venues/pool-prices.ts` hardcoded `cashDecimals: 6` (stale USDG figure) instead of `USDT_DECIMALS` (18) — silent trade-size corruption risk, same bug class flagged in VERIFICATION.md.
- `worker/src/chain.test.ts` asserted old Robinhood chain ids/explorer URLs against the new `chainForId`/`explorerFor` — stale test, now updated to assert BSC ids/URLs.
- `worker/src/wall.test.ts` local `usdg()` helper still computed 6dp amounts against the new 18dp USDT cap math; `packages/core/src/tokens.ts`'s `TRADEABLE_SYMBOLS`/`LEGACY_TRADEABLE_SYMBOLS`/`DEFAULT_BASKET_SYMBOLS` still listed old Robinhood stock tickers (AAPL, QQQ, NVDA...) with zero overlap with the new 4-token BSC list — both fixed.
- `worker/src/mcp.test.ts` and `worker/src/brokerage-store.integration.test.ts` imported the deleted `robinhood-oauth.ts`/`robinhood-id.ts` — the OAuth-specific test block was removed (no BSC equivalent exists yet, v0 has no auth path at all) and the brokerage-settlement integration test was deleted outright (Robinhood-brokerage-specific concept, no BSC equivalent, consistent with `rialto.test.ts`/`robinhood-feed.test.ts` already being deleted by the prior pass).

**Update 2026-08-04, later same day: all 38 fixed. 655/655 worker tests pass, both packages type-check clean.**

- `grant-coverage.test.ts`: symbol mapping NVDA→WBNB, AAPL→BTCB throughout. One test case ("registry stock with no route") removed with an explanatory comment — doesn't apply to v0's curated, all-liquid 4-token registry (merrymen's original had illiquid registry entries like PLTR by design; Warden's v0 doesn't). Realigned `LEGACY_TRADEABLE_SYMBOLS`/`DEFAULT_BASKET_SYMBOLS` in tokens.ts to the "default basket == legacy set" invariant the original code documented but the earlier port had broken (`LEGACY_TRADEABLE_SYMBOLS = ["WBNB"]`, `DEFAULT_BASKET_SYMBOLS = ["WBNB"]`).
- `settings.test.ts`, `legs.test.ts`, `watch-tokens.test.ts`: mechanical symbol swaps (NVDA→WBNB, QQQ→CAKE). One semantic fix: `watchTokensFor` test asserted every registry token has a Chainlink feed — inverted, since no v0 BSC token has one by design (all `kind: "memecoin"`, priced via PancakeSwap TWAP instead).
- **A second real production bug**, same class as the first: `worker/src/venues/pool-prices.ts`'s batch reader still hardcoded `cashDecimals: 6` in a second call site the first fix missed. Made pool liquidity readings ~10^12x too small — would have made the depth-floor guard (the thing that refuses to price a memecoin off a $300 pool) nearly unreachable in practice. Caught because `pool-prices.test.ts`'s "REFUSES a memecoin whose WETH pool holds pocket change" test exercises exactly that guard.
- `pool-prices.test.ts` fixture fix required care, not just rescaling: `liquidityUsdg`/`minLiquidityUsdg` are a **fixed 6dp USD figure by design** (see `cashRawToUsdg`'s docstring in `pool-price.ts`), independent of the cash token's actual decimals — those fixtures correctly stay at `1e6`. Raw mock pool balances standing in for actual on-chain USDT reads needed a *separate* `rawUsdt()` helper at `1e18`. An initial attempt that blindly rescaled everything to `1e18` broke previously-passing tests by conflating the two roles — worth remembering if this pattern recurs elsewhere.
- Two PancakeSwap fee-tier hardcodes in test mocks (`fee !== 3000`, a Uniswap tier) fixed to `2500` (a real PancakeSwap v3 tier — see DECISIONS.md D005).

### Web dashboard Robinhood references (2026-08-04)

Cleaned up, not deferred to Step 5:
- `ChainStats.tsx`, `Statusbar.tsx`: hardcoded Robinhood RPC replaced with `bscChain.rpcUrls` (imported, not re-typed — avoids the exact "written from memory" bug class `chainlinks.ts`'s own comment warns about). `Statusbar.tsx` also: "sequencer" language corrected to "chain" (BSC has no rollup sequencer), the execution-venue line corrected from a Uniswap/Morpho/Rialto claim to the truth (paper-only, no live venue in v0), and the `merrymen.dev` link removed (no Warden domain exists yet — not invented).
- `web/src/lib/session.ts`: `FAUCET_URL` now BNB Chain's real, **VERIFIED** testnet faucet (`bnbchain.org/en/testnet-faucet`, confirmed via `docs.bnbchain.org`'s own faucet page — added to DECISIONS.md-style sourcing directly in the code comment).
- `web/src/app/settings/page.tsx`: RPC override placeholder text updated to real BSC hostnames.
- `web/src/lib/market.ts`: the substantial one. Its whole design (Chainlink stock feeds, Robinhood's Blockscout instance + CDN, Rialto liquidity) has no BSC equivalent and doesn't apply to v0's token registry (no feeds, no Rialto, no Blockscout host verified for BSC). Rewritten to return the registry with price/volume/holders honestly `null` rather than pointing dead network calls at nonexistent/wrong hosts or fabricating a replacement price source — `MarketTable.tsx` already renders nulls as "—"/"no feed" gracefully. Wiring the worker's already-working PancakeSwap v3 TWAP pricing into this web-facing table is real, separate v1/v2 work, not a reference swap — noted in the file's own comment rather than attempted here.
- `scripts/probe-*.mts`: Blockscout host references marked with `TODO(BSC)` rather than guessed at — no verified BSC-equivalent endpoint was found (BscScan is the real explorer but has a different, key-gated API shape). Also fixed the same `cashDecimals`-class bug in `probe-tradability.mts` (`TEN_USDG` was computed at 6dp).
- `protocols.ts`'s `RIALTO.apiBase` intentionally left as-is — already documented as a Robinhood-Chain-only, v1-deferred placeholder, not a loose end.

## Open verification items (blocking)

See [DECISIONS.md](DECISIONS.md#open-verification-items-must-clear-before-the-dependent-step-is-marked-done) for the authoritative list. As of this update, all four v0-blocking items are resolved. One item remains open, and only blocks Phase 2:
1. Kernel v3.1 factory address on BSC — bytecode presence confirmed on-chain, but contract identity not yet conclusively matched to the exact ZeroDev build. Blocks v1 start, not v0.

## Decisions made so far

See [DECISIONS.md](DECISIONS.md) for full log with sources. Summary: forking merrymen (D001), named Warden (D002), targeting BSC (D003), keeping the ZeroDev/Pimlico AA stack (D004, chain support verified — specific factory address still open), targeting PancakeSwap v3 (D005, addresses still open), USDT as base currency (D006, decimals still open), v0 scoped to paper-trading only with no wall (D007).

## How to update this file

After completing a roadmap step: flip its status to Done, note the date, and if it resolved an open verification item, move that item from DECISIONS.md's open list to its "already-verified" section with the confidence level and source. Do not mark a step Done while it still has an open verification item blocking it — that's exactly the kind of unverified-claim-shipped-as-fact this project's process exists to prevent.
