# Verification protocol — how Warden avoids harmful assumptions

Status: active · applies to every contributor, human or AI, on this project.

## Why this document exists

This codebase moves other people's money. A confidently-stated wrong contract address, wrong decimal count, or wrong "yes this chain is supported" is not a bug like a typo — it is a path to losing funds. This document is the mechanical process that stands between "sounds right" and "is verified," for anything that touches money, chain identity, or trust claims.

## The rule

**Any factual claim in code, docs, or discussion that falls into one of the categories below must be tagged with a confidence level and a source, before it is relied on.**

Categories requiring verification:
- Contract addresses (routers, quoters, factories, EntryPoints, tokens)
- Chain IDs, RPC endpoints, block explorer URLs
- Token decimals, symbols, or supply mechanics
- Third-party service claims ("X supports chain Y", "X's bundler covers Z")
- Fee tiers, gas models, or protocol-specific constants
- Anything copied from merrymen that is *assumed* to also be true of BSC

## Confidence levels

| Level | Meaning | Where it may appear |
|---|---|---|
| **VERIFIED** | Checked directly against a primary source: official docs, block explorer, on-chain read (`eth_getCode`, a contract read call), or the project's own test suite. Source is cited inline. | Production code, PRD, DECISIONS.md |
| **ASSUMED** | Carried over from merrymen or inferred by analogy (e.g. "PancakeSwap v3 is a Uniswap v3 fork, so its QuoterV2 ABI is probably the same shape"). Must be explicitly labeled as such in code comments and in DECISIONS.md. | Draft PRs only — must be resolved to VERIFIED or REJECTED before merge to main |
| **UNVERIFIED — BLOCKING** | A known gap, flagged and not yet checked. Blocks the step that depends on it. | TODO markers, PROGRESS.md open items |

## How to verify (in order of preference)

1. **On-chain read**: query the address directly (`eth_getCode` returns non-empty bytecode; call a known view function and check the return shape) against a public BSC RPC. This is the strongest evidence — it doesn't depend on a doc being up to date.
2. **Primary source docs**: the protocol's own official documentation or GitHub repo (e.g. PancakeSwap's contract registry, ZeroDev's chains doc, Pimlico's supported-chains doc) — not a blog post, not a tutorial, not a forum answer.
3. **Block explorer verification**: BscScan-verified source code for the specific address in question, confirming it matches the expected contract (name, compiler, and ideally a diff against the known source).
4. **Cross-reference**: if two independent primary sources agree, confidence rises; if they disagree, treat as UNVERIFIED — BLOCKING until resolved, never average or guess.

**What does not count as verification**: a web search summary alone, a claim carried over from merrymen without checking it applies to BSC, or "this is standard practice so it's probably the same address here." CREATE2 deterministic deployment means an address is *often* identical across chains — but "often" is not "always," and the only way to know is to check.

## Where this shows up in practice

- Every new address or chain constant added to `packages/core/src/chain.ts`, `worker/src/venues/*`, or `contracts/` must have a corresponding entry in [DECISIONS.md](DECISIONS.md) with its confidence level and source.
- Code comments on such constants use the tag format: `// VERIFIED 2026-08-04: <source url or on-chain check performed>` or `// ASSUMED — ported from merrymen, not yet checked against BSC`.
- PROGRESS.md's "open verification items" section is the running list of everything still ASSUMED or UNVERIFIED — it must be empty before a step is marked done in ROADMAP.md.
- When the assistant is not sure whether something is verified or assumed, it says so explicitly rather than presenting it as fact — this is a standing project rule, not a one-time reminder.

## Already-verified facts (carried into DECISIONS.md)

See [DECISIONS.md](DECISIONS.md) for the log. As of this document's creation, verified: BSC ERC-4337 EntryPoint v0.7 deployment, ZeroDev BSC chain support, Pimlico BSC bundler support. Not yet verified: PancakeSwap v3 QuoterV2/Factory addresses on BSC mainnet, USDT-on-BSC decimal count (commonly cited as 18, not Ethereum's 6 — needs a direct on-chain read before being hardcoded), Kernel v3.1 factory deployment address on BSC specifically.
