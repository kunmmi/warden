# Coding rules

These apply on top of, not instead of, [VERIFICATION.md](VERIFICATION.md) — verification governs facts, this governs how code gets written and merged.

## 1. No unverified constants in production code paths

Any address, chain ID, decimal count, or fee-tier constant that reaches `worker/`, `packages/core/`, `contracts/`, or anything the desktop/web app ships must be tagged `// VERIFIED <date>: <source>` per VERIFICATION.md, or the code must not merge to `main`. `ASSUMED`-tagged constants may exist in a feature branch but block that branch's merge.

## 2. Reuse merrymen's patterns; don't invent new ones without reason

Where merrymen already solved a problem in a chain-agnostic way (Telegram command parsing, strategist decision loop, paper-fill simulation, soul/memory persistence), port the pattern rather than redesigning it. Deviating from an existing, working pattern needs a DECISIONS.md entry explaining why — "it seemed cleaner" is not sufficient justification for reinventing something a working, tested reference implementation already does.

## 3. Money-path changes get the highest scrutiny

Anything touching `wall.ts`, `KernelBreakerPolicy.sol`, token approvals, spender allowlists, or signing logic:
- Gets read alongside merrymen's own extensive in-file comments before being changed — those comments document real bugs they found and fixed (e.g. the `NOT_FOR_VALIDATE_SIG` signature-bypass fix in `wall.ts`). Understand why a line exists before touching it.
- Never widens a permission (a new allowed spender, a raised cap, a loosened policy) without an explicit, separate decision entry and a stated reason.
- Gets a corresponding test asserting the exact new shape, following `worker/src/wall.test.ts`'s pattern of asserting shape rather than trusting a refactor preserved it.

## 4. No silent scope creep

If implementation reveals that a "simple config swap" is actually a redesign (this happened once already — the account-abstraction stack looked risky until BSC support was confirmed) — stop, write a DECISIONS.md entry, and surface it before continuing, rather than quietly absorbing the extra scope into the current step.

## 5. Say "I don't know" out loud

If a claim can't be verified with the sources available (rate-limited API, docs page down, ambiguous on-chain read), the code/PR/response says so explicitly — an `UNVERIFIED — BLOCKING` marker, not a best-guess presented as fact. This applies equally to the assistant and to human contributors.

## 6. Every merged step updates PROGRESS.md

A roadmap step is not done until PROGRESS.md reflects it and any verification items it depended on have moved to DECISIONS.md's verified section. "The code works" and "the paper trail says it works" are both required — this is what makes the project auditable later, including by someone who wasn't in this conversation.

## 7. Real funds are a one-way door

No code path that can move real money (not paper-simulated) merges until: the wall test suite passes, the kill switch has been manually exercised, and Phase 2's security review pass (ROADMAP.md) is complete. This is a hard gate, not a target.
