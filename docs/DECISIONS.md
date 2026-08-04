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

**Open gap (UNVERIFIED — BLOCKING for v1)**: attempted to resolve on 2026-08-04, partial progress only:
- A web search surfaced a candidate Kernel v3.1 `KernelFactory` address (`0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419`). Per this project's own verification rule, a search-summarized claim doesn't count as evidence on its own — so it was checked directly: `eth_getCode` on BSC mainnet confirms **live, non-trivial bytecode is present** at that address, matching a deterministic-proxy-factory pattern.
- However, that only proves *something* is deployed there — it does not, on its own, prove that something is specifically ZeroDev's Kernel v3.1 factory matching the SDK versions merrymen pins. The `zerodevapp/kernel` GitHub repo's `releases/v0.4.0.json` confirms Kernel contracts are deployed via a universal CREATE2 deployer (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) with a fixed salt — which explains why the address *would* be identical across chains *if* someone has run the deployment transaction on that specific chain — but the release file contains no explicit per-chain deployment registry to confirm BSC is one of them, and the repo's version label ("v0.4.0") doesn't cleanly map to the "v3.1" terminology used elsewhere, so this needs a cleaner reconciliation.
- **Still UNVERIFIED — BLOCKING for v1**: before wall work begins, confirm this address's bytecode hash matches a known-good Kernel v3.1 factory build (e.g. by comparing against the same address's bytecode on a chain where ZeroDev explicitly confirms deployment, such as Ethereum or Base), rather than relying on presence-of-bytecode alone.

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

---

## Open verification items (must clear before the dependent step is marked done)

Resolved 2026-08-04 (see D005/D006 above for full sourcing): PancakeSwap v3 QuoterV2 + Factory + SwapRouter + SmartRouter addresses on BSC mainnet, PancakeSwap v3 fee tiers on BSC, BSC USDT decimals. All four v0-blocking items are now VERIFIED — **v0 Steps 3 and 4 are unblocked.**

Still open:
1. Kernel v3.1 factory deployment address on BSC — partially investigated 2026-08-04 (bytecode confirmed present at a candidate address; contract identity not yet conclusively matched). Blocks v1 start, does not block v0.
