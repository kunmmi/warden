# Progress report

Last updated: 2026-08-04 (verification pass complete). Update this file whenever a roadmap step's status changes — it's the single source of truth for "where are we right now," so ROADMAP.md doesn't need editing just to reflect status.

## Snapshot

| Phase | Status |
|---|---|
| Phase 0 — Governance docs | Done (this batch) |
| Phase 1 — v0 paper-trading skeleton | Done (2026-08-05/06 rebrand sweep closed out remaining CLI/PWA/Telegram copy) |
| Phase 2 — v1 trust layer | In progress — steps 1-3 of 7 done, see detail below |
| Phase 3 — later | Not scoped |

## Phase 2 detail (2026-08-06)

| Step | Status | Notes |
|---|---|---|
| 1. Resolve Kernel v3.1 factory address on BSC | **Done** | Primary-source npm package inspection + cross-chain bytecode identity + direct BSC confirmation. See DECISIONS.md D004. |
| 2. Port `KernelBreakerPolicy.sol`/`BreakerRegistry.sol` to BSC | **Done** — turned out to need none | Both contracts are pure Solidity with no hardcoded chain/DEX addresses; nothing to port. Only real changes: `contracts/hardhat.config.ts`'s network defs (Robinhood → BSC 56/97 RPC + chain id), and a stale `BreakerRegistry.sol` comment ("USDG 6dp" → "fixed 6dp USD" — the field was always chain/token-decimals-independent, the comment was just wrong). Neither contract is deployed yet — that's separate from writing/porting the source. |
| 3. Rewrite `packages/core/src/wall.ts` against PancakeSwap v3 | **Done** | Full rewrite: single approved spender (PancakeSwap's SwapRouter), Permit2/UniversalRouter/Rialto/Morpho all dropped (not just defaulted off) — see DECISIONS.md D008 for the full reasoning and the source-verified 8-field `ExactInputSingleParams` struct shape (PancakeSwap kept `deadline`, Uniswap's SwapRouter02 didn't — this was verified against `pancake-v3-contracts`' actual `ISwapRouter.sol`, not assumed from the Uniswap shape). New `PANCAKESWAP_SWAP_ROUTER_ABI` in `packages/core/src/abis.ts`. `worker/src/wall.test.ts` fully rewritten and passing (10/10), including the calldata-offset proof against the new 8-member tuple. Direct consumers fixed to stay consistent with the new wall shape: `worker/src/index.ts`'s `limitsFromGrant` (the off-chain policy mirror — now lists only PancakeSwap's router + USDT, matching the on-chain wall exactly instead of still claiming Rialto/Uniswap-v4/Morpho targets the wall no longer authorises), `web/src/lib/session.ts` (grant minting), `web/src/app/api/wall/route.ts` ("prove the wall" simulator). Full worker suite: 639/639 passing, `tsc --noEmit` clean on core/worker/web. |
| 4. Wire ZeroDev Kernel account creation + Pimlico bundler in onboarding | **Not started (as end-to-end verification)** | `web/src/lib/session.ts`'s `mintGrant` already does real Kernel account derivation + grant signing (pre-existing from the original merrymen port) and needed only the wall-shape fixes above — but nothing has been end-to-end tested against BSC yet (no funded testnet wallet exercised through the full flow in this session). |
| 5. Session-key signing, live trade execution, kill switch | **Done, as of 2026-08-06 — see DECISIONS.md D009** | Session-key signing (`worker/src/executor.ts`) and the kill switch (grant-file deletion) were already-portable, chain-agnostic merrymen infrastructure — never blocked, just had no valid BSC venue to execute against. That gap is now closed: `worker/src/venues/pancakeswap-v3.ts` gained `buildSwapCall`/`buildTradeCalls` (approve + exactInputSingle/exactInput against PancakeSwap's SwapRouter, `deadline` field included per the D008-verified struct shape — no Permit2 hop), wired into `worker/src/index.ts`'s tick loop, chat-trade path, and strategy-built intents (`swapRouterFor()` fixed too — its old `"uniswap"` ternary branch had become permanently unreachable once `swapVenue` narrowed to a single value, so it was silently falling through to `RIALTO.routerSnapshot`, an address the wall no longer authorises; caught before it shipped). `worker/src/settings.ts`'s `swapVenue` config narrowed from `"uniswap" \| "rialto"` to `"pancakeswap"` (web UI select and API route validation updated to match). 14 new tests for the execution helpers (`worker/src/venues/pancakeswap-v3.test.ts` — this file's quoting functions had zero coverage before this pass too, now covered alongside). Full worker suite: 653/653. `tsc --noEmit` clean on core/worker/web/mobile (mobile's `signGrant.ts` — which also had a live `GRANT_V4` reference, since removed — shows zero errors; mobile's broader typecheck has pre-existing, unrelated Expo-toolchain/target-config issues not touched by this pass). **Not yet done: end-to-end testing against BSC with a real funded testnet wallet** — nothing has executed a real UserOp on BSC in this session. |
| 6. Security review pass | Not started | Should follow real end-to-end BSC testing (step 4/5's remaining piece), not precede it. |
| 7. Wall test suite | **Done for the new shape** | `worker/src/wall.test.ts` — see step 3. |

### Also cleaned up alongside step 5 (2026-08-06)
`GRANT_V4`/`grantHasV4` (the Uniswap-v4-specific grant-feature marker) were fully removed from `packages/core/src/grant.ts` — they had no consumers left in worker, web, or mobile once the wall dropped v4 (D008). `mobile/src/crypto/signGrant.ts` had the exact same stale-`GRANT_V4`-in-`grantFeatures` issue `web/src/lib/session.ts` was fixed for in the wall pass, caught and fixed for consistency (wall.ts's own header comment warns explicitly against multiple grant-issuing clients drifting apart).

### Live verification against BSC testnet (2026-08-06/07)

Booted the actual dashboard + worker (not just tests) and exercised the real grant-signing flow against a pre-existing testnet account (`0x1879104aEE5Ee218A808257Af25BC846F8621a6F`, chain 97) left over from earlier work — this account's stored grant predated the wall port and still targeted Uniswap's SwapRouter02, proving in practice the exact "fleet running a mix of walls" scenario wall.ts's header comment warns about.

- **Real bug found live, not in a test**: `web/src/app/grant/page.tsx` — the single most user-facing page in the app — still had ~30 unfixed occurrences of "merrymen"/"USDG"/"the band"/"merryman"/"Robinhood Chain", plus archer-narrative preset names ("the outlaw", "the warlord"). This had been flagged as out-of-scope during the CLI/PWA rebrand pass but was never actually swept. Found by looking directly at the running page, not by grep — fixed in full: brand text, USDT/BNB units, `warden recover`/`warden kill`/`warden start` CLI references, preset labels renamed to plain risk tiers (cautious/balanced/bold). `tsc --noEmit -p web` clean after.
- Used the dashboard's own "restore a funded wallet" flow (owner key already on disk in `~/.warden/grant.json` from earlier testnet setup, explicitly TESTNET-ONLY per `StoredGrant`'s own field documentation) to re-derive the same smart account and sign a **fresh grant under the new wall**.
- **Verified directly against the signed grant's own serialized policy** (not assumed): decoded `~/.warden/grant.json`'s `serialized` field and confirmed its call-policy target list is exactly `[USDT, WBNB, CAKE, BTCB, ETH, PANCAKESWAP.swapRouter]` — Uniswap's old SwapRouter02 address, Morpho's vault, Permit2, and UniversalRouter are all gone; `grantFeatures` no longer carries `"v4"`. This is the wall's real, on-chain-enforced shape confirmed from a real signature, not from reading the source.
- Confirmed the real Kernel-account-derivation path works against BSC testnet: the dashboard's "check this wallet" step made a real `eth_call` and correctly read `0.00 USDT · 0.00000 BNB` for the (genuinely unfunded) account.
- **Confirmed the off-chain policy mirror enforces the new wall live, in the running worker**: the worker's own tick log shows `[policy] REJECTED vault-deposit: target-allowlist — target 0xBeEff033F34C046626B8D0A041844C5d1A5409dd not allowed` — Morpho's vault, attempted by a strategy, correctly refused by `limitsFromGrant`'s now-narrowed allowlist (D009). Real-time confirmation of the same fix the unit tests already covered.

**Update 2026-08-07 — funded, and a real UserOp landed.** The account got funded (~0.3 tBNB) and a Pimlico bundler key configured. This surfaced two more real, now-fixed bugs, plus one still-open issue — full diagnostic trail:

1. **Fixed**: `--selftest`'s same-token probe branch was dead code (condition excluded same-token intents from the swap branch entirely) — see commit `3f4eb9a`. Before this, `--selftest` printed "done" without ever sending anything.
2. **Fixed**: `@zerodev/permissions@5.6.3`'s `deserializePermissionAccount` drops the `flag` used at grant-signing time (`WALL_POLICY_FLAG`), so every first UserOp for any wall-governed account reverted with Kernel's `EnableNotApproved()`. Root-caused by reading the SDK's own source, fixed with a from-scratch reimplementation in `executor.ts` — see commit `402ed1e`.
3. **Isolated, still open**: after both fixes, the selftest still fails — `AA23 reverted 0x` (empty return data) specifically during the session-key permission validator's first-ever "enable" step. Ruled out via direct testing:
   - **Not gas**: retried with manually-supplied gas limits up to 5,000,000 (bypassing estimation entirely) — same failure.
   - **Not deployment**: deployed the account via a pure SUDO-signed UserOp (owner key only, zero permission-validator involvement) — **this succeeded**, a real transaction landed on BSC testnet: [`0x0d342dc3913def3c22a54763eb00f4ef0bd4ae50ed308775c6d5e5172fbad0ae`](https://testnet.bscscan.com/tx/0x0d342dc3913def3c22a54763eb00f4ef0bd4ae50ed308775c6d5e5172fbad0ae), block 123698797. Retried `--selftest` against the now-deployed account — same `AA23 reverted 0x`, this time with no `factory`/`factoryData` in the request at all, conclusively isolating the failure to the permission-validator enable step, independent of deployment.
   - **Not hidden error detail**: queried Pimlico's `eth_estimateUserOperationGas` directly via raw JSON-RPC and dumped viem's full nested error object (`cause`, `cause.cause`, `cause.data`) — no additional detail exists beyond "AA23 reverted 0x". The bundler's own simulation genuinely returns empty revert data; this isn't a client-side formatting/wrapping issue.
   - **Confirmed real end-to-end infrastructure**: the sudo-only deploy proves the funded account, RPC, bundler, fee estimation, and EntryPoint submission all work correctly. The remaining mystery is narrowly scoped to Kernel's on-chain enable-mode signature/policy-install logic for a session-key permission validator specifically.

**Resolved 2026-08-26 — the empty `AA23 reverted 0x` was a missing on-chain module, not a Kernel/Pimlico bug.** `eth_getCode` against `RATE_LIMIT_POLICY_CONTRACT` (`@zerodev/permissions`' default RateLimitPolicy address, `0xf63d4139...86873`) showed no bytecode on BSC testnet — only mainnet. Kernel's enable-mode policy-install loop was calling a code-less address, which reverts with no data; that empty revert happened to surface identically through Pimlico's bundler and through a direct `eth_call`, which is what made it look like a signature/validation-logic bug for so long rather than a deployment gap.

Fix: `@zerodev/permissions` ships a second, functionally-identical module — `RATE_LIMIT_POLICY_WITH_RESET_CONTRACT` — deployed on **both** BSC mainnet and testnet (confirmed via `eth_getCode` on both chains). `wall.ts` now points `toRateLimitPolicy` at it explicitly via the `policyAddress` param; the only field the two variants differ on (`startAt`) was never used here. See commit `115487f`.

Verified end-to-end against the real chain, not a local fork: re-signed a grant for the already-funded demo account (same owner key -> same smart account address) with the fixed wall and submitted it through Pimlico. It landed — [`0xe5174e5169a0716e8b683d505b1a95bd26713c6617a243a9d240f20b8919ddfd`](https://testnet.bscscan.com/tx/0xe5174e5169a0716e8b683d505b1a95bd26713c6617a243a9d240f20b8919ddfd) — the first successful enable-mode UserOp since the wall was ported to BSC. Full worker suite: 654/654.

**Filed and closed as not-needed**: [zerodevapp/kernel#153](https://github.com/zerodevapp/kernel/issues/153) originally asked ZeroDev for the CREATE2 salt to redeploy the missing module — turned out unnecessary once the WITH_RESET alternative was found already live on testnet.

**Still a real, separate limitation, not a bug**: PancakeSwap's SwapRouter and the USDT/WBNB/CAKE/BTCB/ETH addresses the wall approves are mainnet-only deployments (confirmed via `eth_getCode` — none of them have bytecode on chain 97). The enable step and an `approve()` call now succeed on testnet; an actual `exactInputSingle` swap will still no-route there, same as documented in `web/src/lib/session.ts`'s `mintGrant` comment ("the wall is real on mainnet and inert on testnet"). A live end-to-end swap demo needs either a testnet DEX deployment or a small-amount mainnet run.

### Dead-venue cleanup, prompted by the live-testing session (2026-08-07)

The live worker log from the section above surfaced a real, permanent-but-harmless bug: `steady-basket` (the default strategy) was proposing a `vault-deposit` every single tick that the new wall's off-chain mirror correctly refused, forever, since no BSC Morpho (or equivalent) vault is wired in. See DECISIONS.md D010 for full detail. Fixed:
- `worker/src/strategies/steady-basket.ts`: `vault` config field made optional; both vault-deposit and vault-withdraw proposal paths now skip cleanly when unset.
- `worker/src/strategies/registry.ts`: no longer passes a vault address for the default strategy.
- `worker/src/strategies/custom.ts`: `StrategyCtx` (injected into every user-authored strategy) no longer exposes `UNISWAP`/`RIALTO`/`MORPHO` — only `PANCAKESWAP`.
- `strategies/example-dip-buyer.mjs` (the template scaffolded for new custom strategies): fully updated off the old `ctx.UNISWAP`/`ctx.MORPHO`/`ctx.CASH.USDG`/merrymen-CLI shape — would otherwise have shipped broken example code.
- New test in `steady-basket.test.ts` asserting no vault intent is proposed when `vault` is unset. Full worker suite: 654/654.

Deliberately left alone: `worker/src/snapshot.ts`'s Morpho vault-balance read, which is a display-only historical/paper-accounting read, not a live execution path.

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

See [DECISIONS.md](DECISIONS.md#open-verification-items-must-clear-before-the-dependent-step-is-marked-done) for the authoritative list. As of 2026-08-06, **no open verification items remain** — Kernel v3.1's factory/implementation/meta-factory addresses on BSC were resolved via primary-source npm package inspection + cross-chain bytecode identity + direct BSC confirmation. Phase 2 (v1) is unblocked and in progress.

## Decisions made so far

See [DECISIONS.md](DECISIONS.md) for full log with sources. Summary: forking merrymen (D001), named Warden (D002), targeting BSC (D003), keeping the ZeroDev/Pimlico AA stack (D004, chain support verified — specific factory address still open), targeting PancakeSwap v3 (D005, addresses still open), USDT as base currency (D006, decimals still open), v0 scoped to paper-trading only with no wall (D007).

## How to update this file

After completing a roadmap step: flip its status to Done, note the date, and if it resolved an open verification item, move that item from DECISIONS.md's open list to its "already-verified" section with the confidence level and source. Do not mark a step Done while it still has an open verification item blocking it — that's exactly the kind of unverified-claim-shipped-as-fact this project's process exists to prevent.
