# Decision log

Format: each entry has a decision, the reasoning, and — critically — a confidence level and source per [VERIFICATION.md](VERIFICATION.md). Entries are append-only; if a decision is reversed, add a new entry rather than editing history.

---

### D001 — Fork merrymen rather than build from scratch
**Decision**: start from `millw14/merrymen`'s codebase, strip Robinhood-specific pieces, port to BSC.
**Reasoning**: the portable ~60% (Telegram, strategist, soul, paper engine, UI shells) is chain-agnostic and would otherwise be rebuilt for no benefit.
**Confidence**: N/A (architectural choice, not a factual claim).

### D002 — Name: Warden
**Decision**: project name is Warden.
**Reasoning**: short, memorable, "security product" connotation appropriate for a fund-custody tool. See earlier logo concepts (shield + keyhole mark).
**Confidence**: N/A.

### D003 — Target chain: BSC (BNB Smart Chain, chain ID 56)
**Confidence**: VERIFIED.
**Source**: standard, well-known chain ID; not independently re-derived here but not in dispute.

### D004 — Account-abstraction stack: ZeroDev Kernel + `@zerodev/permissions` + Pimlico bundler (same as merrymen)
**Decision**: keep merrymen's AA stack rather than switching providers, since it supports BSC.
**Confidence**: VERIFIED (chain-support claim). Kernel factory identity: still open, see below.
**Source**:
- ZeroDev chains FAQ (`docs.zerodev.app/sdk/faqs/chains`) lists "Binance Smart Chain / 56" in its regular EVM networks table. Checked 2026-08-04.
- Pimlico supported-chains doc (`docs.pimlico.io/guides/supported-chains`) lists BNB Chain, chain ID 56, slug `binance`, supporting EntryPoint v06/v07/v08. Checked 2026-08-04.
- Directly confirmed on-chain: the ERC-4337 EntryPoint v0.7 address merrymen pins (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`) is deployed and active on BSC mainnet.

**RESOLVED 2026-08-06 — VERIFIED.**
- **Primary source**: downloaded the actual `@zerodev/sdk` npm package tarball directly from the npm registry (`registry.npmjs.org/@zerodev/sdk/-/sdk-5.5.10.tgz`, version 5.5.10, the `latest` dist-tag at check time — not a docs page, not a search summary) and read `constants.ts`'s `KernelVersionToAddressesMap` source directly. Its `"0.3.1"` entry (exported as `KERNEL_V3_1`) hardcodes, globally (no per-chain override in this map):
  - `accountImplementationAddress: 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D`
  - `factoryAddress: 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419`
  - `metaFactoryAddress: 0xd703aaE79538628d27099B8c4f621bE4CCd142d5`
- **Cross-chain bytecode identity**: fetched `eth_getCode` for the factory address on BSC, Base, and Arbitrum mainnet via independent public RPCs (`bsc-dataseed.binance.org`, `mainnet.base.org`, `arb1.arbitrum.io/rpc`) on 2026-08-06 — the returned bytecode is byte-for-byte identical (2016-char hex payload, `diff` confirms only a trailing-newline artifact, no content difference) across all three chains, and the embedded implementation address inside that bytecode matches `0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D` exactly. This confirms deterministic CREATE2 deployment, not a coincidental same-address-different-contract collision.
- **BSC-specific confirmation**: `eth_getCode` for all three addresses (meta factory, factory, Kernel implementation) directly on BSC mainnet via `bsc-dataseed.binance.org` on 2026-08-06 — all three return live, non-empty bytecode.
- **Conclusion**: the Kernel v3.1 deployment triplet used by ZeroDev's own current SDK is confirmed live on BSC mainnet. This item no longer blocks v1.

### D005 — DEX venue: PancakeSwap v3
**Decision**: v0/v1 target PancakeSwap v3 as the execution venue, not Uniswap (which merrymen used) or PancakeSwap v2.
**Reasoning**: PancakeSwap v3 is the dominant BSC DEX by volume; a Uniswap v3 fork, so the existing `worker/src/venues/uniswap.ts` QuoterV2 pattern in merrymen is structurally close to portable.
**Confidence**: VERIFIED (addresses and fee tiers below). The "ABI shapes are near-identical to Uniswap v3" claim remains ASSUMED until the actual `pancakeswap-v3.ts` venue file is written and its calls tested against a live quote — structural similarity of the fork doesn't guarantee byte-identical calldata encoding.
**Source — contract addresses**: `pancakeswap/pancake-v3-contracts` repo, `deployments/bscMainnet.json` (the project's own canonical deployment record), cross-checked against independent BscScan listings, then confirmed live via `eth_getCode` on BSC mainnet (bytecode present, non-empty) on 2026-08-04:
| Contract | Address | On-chain bytecode confirmed |
|---|---|---|
| PancakeV3Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | Yes |
| QuoterV2 | `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` | Yes |
| SwapRouter | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` | Yes |
| SmartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | Yes |

**Source — fee tiers**: read directly from `PancakeV3Factory.sol`'s constructor in the same repo (`projects/v3-core/contracts/PancakeV3Factory.sol`) — hardcodes exactly four fee tiers at deploy time: 100 (tick spacing 1), 500 (tick spacing 10), 2500 (tick spacing 50), 10000 (tick spacing 200). This is source-level confirmation, not inference from a doc.

### D006 — Base trading currency: USDT
**Decision**: use USDT as the "CASH" equivalent (merrymen used USDG on Robinhood Chain).
**Reasoning**: deepest pool liquidity on BSC/PancakeSwap versus USDC or BUSD (BUSD is being wound down by Binance).
**Confidence**: liquidity-depth claim remains ASSUMED (general market knowledge, not measured directly for this project). **Decimals: VERIFIED.**
**Source — decimals**: direct on-chain `eth_call` to `0x55d398326f99059fF775485246999027B3197955` (BSC USDT) via public RPC `bsc-dataseed.binance.org`, 2026-08-04. `decimals()` returned `0x12` = **18** (confirms the commonly-cited figure — differs from Ethereum mainnet USDT's 6 decimals, so this cannot be assumed by analogy). `symbol()` returned "USDT". Contract has live bytecode.

### D007 — v0 scope: paper trading only, no on-chain wall
**Decision**: v0 ships LLM strategist + paper fills against live BSC price data, with zero wallet/AA/wall integration. The wall (D004's Kernel/Pimlico work) is deferred to v1.
**Reasoning**: de-risks the build by proving the trading/Telegram/strategist pipeline before touching the security-critical, fund-custody code path.
**Confidence**: N/A (scoping decision).

### D008 — v1 wall ported to PancakeSwap v3 only; Permit2/UniversalRouter/Rialto/Morpho dropped
**Decision**: `packages/core/src/wall.ts` (the on-chain call-policy definition) now authorises exactly one router — PancakeSwap v3's classic SwapRouter (D005) — as the sole approved spender. Uniswap's Permit2 + UniversalRouter path, the Rialto meta-router, and the Morpho Steakhouse vault are all dropped from the wall entirely (not even opt-in), not just switched off by default.
**Reasoning**:
- PancakeSwap v3's classic SwapRouter takes a direct ERC20 `approve()` (standard `transferFrom` pull), unlike Uniswap v4's `UniversalRouter`, which only ever moves tokens via a Permit2 allowance. There is no PancakeSwap-side reason to carry Permit2/UniversalRouter at all, and every unused approved spender is a standing liability (see the "unused router is a standing licence" reasoning already in wall.ts's `allowedSpenders` doc comment).
- Rialto is a Robinhood-Chain-proprietary meta-router (`packages/core/src/protocols.ts` `RIALTO.apiBase`) with no BSC deployment, verified or otherwise.
- Morpho: `MORPHO.steakhouseUsdgVault` is a Robinhood-Chain-only deployment (`packages/core/src/protocols.ts` comment: "Morpho on chain 4663"). No BSC Morpho vault address has been verified for this project, so it cannot be sealed into a session-key policy — an unverified address in a fund-custody contract is exactly what VERIFICATION.md exists to prevent. Vault/yield functionality is out of v1 scope; may return in a later phase once a specific BSC vault is independently verified.
**Confidence**: VERIFIED — PancakeSwap v3 SwapRouter's exact `ExactInputSingleParams`/`ExactInputParams` struct shape (field names, types, AND ORDER) read directly from `pancakeswap/pancake-v3-contracts`' `projects/v3-periphery/contracts/interfaces/ISwapRouter.sol` on GitHub, 2026-08-06 — not assumed from Uniswap's shape. This mattered: PancakeSwap's version KEPT the `deadline` field that Uniswap's SwapRouter02 dropped, making the struct an 8-member tuple instead of 7. `recipient` still lands at calldata offset 3×32 (deadline was inserted after recipient, not before) — verified against the source, not carried over by assumption from the Uniswap wall.test.ts already had, which used to prove the SAME offset against a DIFFERENT (7-member) struct shape.
**Source**: `raw.githubusercontent.com/pancakeswap/pancake-v3-contracts/main/projects/v3-periphery/contracts/interfaces/ISwapRouter.sol` (fetched 2026-08-06).
**Scope note, UPDATED 2026-08-06**: the paragraph above described the state right after the wall.ts rewrite, before execution was wired. As of the same day, later: `worker/src/venues/pancakeswap-v3.ts` gained `buildSwapCall`/`buildTradeCalls` (verified against the same `ISwapRouter.sol` source as the wall's ABI — approve + exactInputSingle/exactInput, `deadline` field included, no Permit2 hop), `worker/src/index.ts`'s swap-execution branch now calls them instead of the old Uniswap venue file, `swapRouterFor()` now returns `PANCAKESWAP.swapRouter`, and `worker/src/settings.ts`'s `swapVenue` config narrowed from `"uniswap" | "rialto"` to the single valid value `"pancakeswap"` (web UI and API route validation updated to match). `worker/src/venues/uniswap.ts`/`uniswap-v4.ts` remain in the tree, still tested, but are no longer wired into the tick loop. **Still not done**: `worker/src/strategies/custom.ts`'s sandboxed-strategy globals still expose raw `UNISWAP`/`RIALTO`/`MORPHO` objects to user scripts, `worker/src/strategies/registry.ts` still references the Morpho vault, and `worker/src/snapshot.ts` still displays a Morpho vault balance — none of these are wired to anything that executes, so they're inert rather than wrong, but they're stale surface a future cleanup pass should remove.

### D009 — real trade execution wired to PancakeSwap v3 (2026-08-06)
**Decision**: `worker/src/venues/pancakeswap-v3.ts` gained execution helpers (`buildSwapCall`, `buildTradeCalls`, `SwapCall`), and `worker/src/index.ts`'s live-trade branch (previously gated on the now-impossible `cfg.swapVenue === "uniswap"`) now calls them. `swapRouterFor()` — which feeds `TradeIntent.target` for both chat trades and strategy-built intents — now returns `PANCAKESWAP.swapRouter` instead of falling through to `RIALTO.routerSnapshot` (a real bug this change caught: with `swapVenue` narrowed to `"pancakeswap"` only, the old ternary's `=== "uniswap"` branch could never be true again, so every trade's intent would have targeted Rialto — an address the wall no longer authorises — and been refused by the off-chain policy check before ever reaching execution).
**Reasoning**: the wall (D008) already authorises exactly this call shape on-chain; leaving the tick loop pointed at the old Uniswap venue file left every real trade attempt refused by the (correctly updated) off-chain policy mirror, per D008's "fails closed, not silently" note — this closes that gap rather than leaving it as permanent scope.
**Confidence**: VERIFIED — `PANCAKESWAP_SWAP_ROUTER_ABI` reused from D008's already-source-verified struct shape; 14 new tests in `worker/src/venues/pancakeswap-v3.test.ts` (previously zero coverage on this file's quoting functions too) plus the full worker suite (653/653) confirm the call shape, `tsc --noEmit` clean across core/worker/web/mobile.
**Scope note**: `worker/src/strategies/custom.ts`/`registry.ts`/`snapshot.ts`'s stale Uniswap/Rialto/Morpho references (see D008's updated scope note above) remain untouched — inert, not wrong, and not this change's job to clean up.

### D010 — steady-basket's vault leg made optional; the dead Uniswap/Rialto/Morpho references cleaned up (2026-08-07)
**Decision**: `worker/src/strategies/steady-basket.ts`'s `SteadyBasketConfig.vault` is now `\`0x${string}\` | undefined` rather than required, and `worker/src/strategies/registry.ts` passes no vault for BSC. `worker/src/strategies/custom.ts`'s `StrategyCtx` (the object injected into every custom/user-authored strategy) no longer exposes `UNISWAP`/`RIALTO`/`MORPHO` — only `PANCAKESWAP`, the wall's one approved router.
**Reasoning**: found live, not hypothetically — while testing the re-signed grant (see the "Live verification" entry in docs/PROGRESS.md), the running worker's own tick log showed `[policy] REJECTED vault-deposit: target-allowlist — target 0xBeEff033F34C046626B8D0A041844C5d1A5409dd not allowed` on EVERY tick. `steady-basket` — the default built-in strategy — proposes a vault-deposit whenever idle cash clears its floor, and since no BSC vault has a verified deployment or a wall permission (D008), that proposal was guaranteed-rejected forever: harmless (fails closed, no funds move) but permanent log noise for zero benefit, and idle cash effectively parked nowhere instead of just staying as cash. `StrategyCtx` exposing `UNISWAP`/`RIALTO`/`MORPHO` was the same shape of problem one level up — a custom strategy author copying the example file would write code that silently never trades, since any swap/vault intent naming those addresses is refused by `checkPolicy`'s target-allowlist before it goes anywhere.
**Confidence**: N/A (scoping/cleanup decision, not a factual claim). 15/15 `steady-basket.test.ts` tests pass including a new one asserting no vault-deposit/withdraw is proposed when `vault` is unset; full worker suite 654/654; `tsc --noEmit` clean on worker/web.
**Also fixed**: `strategies/example-dip-buyer.mjs` (the template new custom strategies get copied from) still referenced `ctx.UNISWAP.swapRouter02`/`ctx.MORPHO.steakhouseUsdgVault`/`ctx.CASH.USDG`/the merrymen CLI — updated to the current `ctx.PANCAKESWAP`/`ctx.CASH.USDT` shape and `warden` CLI commands, since it would otherwise have shipped broken code to the first person who copied it.
**Scope note, unchanged**: `worker/src/snapshot.ts`'s `readAccountBalances` still reads a Morpho vault balance for DISPLAY — a historical/paper-accounting read, not a live execution capability, deliberately left as-is.

---

## Open verification items (must clear before the dependent step is marked done)

Resolved 2026-08-04 (see D005/D006 above for full sourcing): PancakeSwap v3 QuoterV2 + Factory + SwapRouter + SmartRouter addresses on BSC mainnet, PancakeSwap v3 fee tiers on BSC, BSC USDT decimals. All four v0-blocking items are now VERIFIED — **v0 Steps 3 and 4 are unblocked.**

Resolved 2026-08-06: Kernel v3.1 factory/implementation/meta-factory addresses on BSC — see D004 above. **No open verification items remain. v1 is unblocked.**
