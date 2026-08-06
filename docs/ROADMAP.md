# Roadmap

Status: draft · tracks against [PRD.md](PRD.md) requirements. Live status per step lives in [PROGRESS.md](PROGRESS.md) — this file is the plan, that file is the state.

## Phase 0 — Governance (this batch of docs)
- [x] PRD, roadmap, progress tracker, decision log, verification protocol, coding rules

## Phase 1 — v0: paper-trading skeleton
Matches the approved build plan at `C:\Users\kunmi!\.claude\plans\enchanted-splashing-possum.md`.

1. Fork `millw14/merrymen`, strip Robinhood-identity code (auth, feed, id, Rialto venue, OAuth UI)
2. BSC chain config in `packages/core/src/chain.ts`
3. PancakeSwap v3 read-only quoting venue — **blocked on** DECISIONS.md open item #2 (QuoterV2/Factory addresses) and #4 (fee tiers)
4. BSC token list in `packages/core/src/tokens.ts` — **blocked on** DECISIONS.md open item #3 (USDT decimals)
5. Rebrand sweep (name, logo, copy, Telegram persona)
6. End-to-end verification: paper trades against live BSC prices, Telegram control working

**Exit criteria**: PRD §6 v0 success criteria met. No open verification items remain for anything v0 touches.

## Phase 2 — v1: the trust layer
This is the security-critical phase — do not start until Phase 1 is fully verified and stable.

1. [x] Resolve DECISIONS.md open item #1 (Kernel v3.1 factory address on BSC) — done 2026-08-06
2. [x] Port `contracts/contracts/KernelBreakerPolicy.sol`/`BreakerRegistry.sol` to BSC — done 2026-08-06 (turned out to be pure Solidity, no chain-specific addresses; only `hardhat.config.ts`'s network config needed changing)
3. [x] Rewrite `packages/core/src/wall.ts` — `allowedSpenders()`, call/rate-limit/timestamp policies — against PancakeSwap v3's router, PancakeSwap-verified ABI — done 2026-08-06, see PROGRESS.md for detail and DECISIONS.md D008
4. [ ] Wire ZeroDev Kernel account creation + Pimlico bundler for BSC in the desktop/web onboarding flow — partially pre-existing (`web/src/lib/session.ts`), not yet end-to-end tested against BSC
5. [ ] Session-key signing, live trade execution, kill switch — **blocked on porting `worker/src/venues/uniswap.ts`'s trade-call builders to PancakeSwap v3's verified (8-field, `deadline`-carrying) `ExactInputSingleParams` shape**, and rewiring `settings.ts`/`strategies/custom.ts`/`strategies/registry.ts`/`snapshot.ts` off the dead Uniswap/Rialto/Morpho venue set (discovered during step 3, see DECISIONS.md D008's scope note) — **this is the concrete next step**
6. [ ] Security review pass modeled on merrymen's own — a full read-through for signature-bypass-style holes (see `wall.ts`'s documented `NOT_FOR_VALIDATE_SIG` fix as the template for the kind of bug class to hunt for) before any real funds touch it
7. [x] Wall test suite equivalent to `worker/src/wall.test.ts` — asserts the exact shape of what a session key can do, so a refactor can't silently widen permissions — done 2026-08-06 for the new PancakeSwap-only shape (10/10 passing, full worker suite 639/639)

**Exit criteria**: PRD §6 v1 success criteria met, kill switch manually tested, wall test suite passing.

## Phase 3 — later (not scoped yet)
- Real-money trading beyond a curated token list
- Mobile app port
- PC remote-control features (if wanted at all — currently a non-goal per PRD §4.3)

Each phase's items get re-evaluated against the PRD before starting — this roadmap is not a commitment to build everything listed if the PRD's non-goals change.
