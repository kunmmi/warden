# Warden — product requirements document

Status: draft v0.1 · owner: Kunmi · last updated 2026-08-04

## 1. What this is

Warden is a self-hosted trading agent for BSC (BNB Smart Chain), forked and adapted from [merrymen](https://github.com/millw14/merrymen) (a Robinhood Chain equivalent). It runs on the user's own machine, holds no custodial keys on a third-party server, and is steered from Telegram. An LLM strategist proposes trades; deterministic code and an on-chain policy wall are the only things that can ever move funds.

## 2. Why

First-party or custodial trading bots require trusting someone else's server, keys, and discretion. Warden inverts that: the agent runs locally, the wallet is a smart account whose spending limits are enforced on-chain by a contract the user can verify in a block explorer — not by a promise in a terms-of-service document. A compromised or misbehaving agent can trade inside the caps; it cannot exceed them, and it cannot sign anything outside them.

## 3. Who it's for

A single self-hosting user (initially the project owner) who wants to run an automated BSC trading agent without giving up custody of funds, and who is comfortable running a local Node process and a Telegram bot.

## 4. Core requirements

### 4.1 Must-haves (v0)
- Runs entirely on the user's machine; no cloud custody of keys or funds.
- LLM strategist proposes buy/sell/hold decisions against real BSC market data.
- Paper-trading mode: real price data, simulated fills, zero real funds.
- Telegram control: status, trade commands, daily digest — same UX as merrymen.
- No trace of Robinhood-specific or merrymen-specific branding, tokens, or auth flows.

### 4.2 Must-haves (v1)
- On-chain policy wall (session-key account contract) enforcing per-trade cap, daily cap, ops/day, drawdown breaker, key expiry — verifiable in a BSC block explorer.
- Real trade execution against PancakeSwap v3, gated by the wall.
- Kill switch that revokes the on-chain grant.
- Every trade simulated (quoted, minOut-checked) before being signed.

### 4.3 Non-goals (explicitly out of scope unless revisited)
- Multi-user / hosted / SaaS mode. This is single-user, self-hosted only, matching merrymen's model.
- Supporting arbitrary long-tail tokens on day one — v0/v1 ship with a small curated token list.
- PC remote-control features (merrymen has these; not required for Warden's core trading use case — revisit later if wanted).
- Mobile app — desktop/CLI + web dashboard first; mobile is a port of merrymen's, deferred.

## 5. Constraints and hard rules

- **No financial credentials, private keys, or seed phrases are ever entered by, transmitted through, or stored by the assistant during development.** All wallet creation and key custody happens client-side, matching merrymen's `~/.warden`-equivalent local storage model.
- **No claim about a contract address, chain ID, token decimal count, or third-party service's chain support ships without a cited, checkable source.** See [DECISIONS.md](DECISIONS.md) and [VERIFICATION.md](VERIFICATION.md) — this is the project's core defense against silently-wrong assumptions in a codebase that moves real money.
- Real-money execution (v1+) does not start until the on-chain wall has an equivalent to merrymen's `worker/src/wall.test.ts` — tests that assert the exact shape of what a session key is permitted to do.

## 6. Success criteria

- **v0 done when**: a fresh clone, following the README, boots a worker that trades on paper against live BSC prices, controllable from Telegram, with zero "merrymen"/"Robinhood" strings left in the codebase or UI.
- **v1 done when**: the same agent can be switched to live mode, trades are capped and verifiable on-chain, and the kill switch has been manually tested to actually halt trading.

## 7. Related documents

- [ROADMAP.md](ROADMAP.md) — phased delivery plan
- [PROGRESS.md](PROGRESS.md) — living status tracker
- [DECISIONS.md](DECISIONS.md) — decision log with sources
- [VERIFICATION.md](VERIFICATION.md) — the anti-assumption protocol
- [CODING_RULES.md](CODING_RULES.md) — engineering rules
- Build plan: `C:\Users\kunmi!\.claude\plans\enchanted-splashing-possum.md` (v0 implementation plan, approved 2026-08-04)
