/**
 * Steady Basket — Phase 1's deterministic strategy. No LLM anywhere.
 * DCA a fixed USDG amount into a weighted stock-token basket on a schedule,
 * and — ONLY when `cfg.vault` names a real, wall-approved vault — park idle
 * USDG there between buys.
 *
 * `vault` is undefined on BSC today: no Morpho (or equivalent) vault has a
 * verified BSC deployment (see D008 in docs/DECISIONS.md), and the on-chain
 * wall (packages/core/src/wall.ts) grants no vault-deposit/withdraw
 * permission at all. Proposing one anyway wouldn't just fail — it would fail
 * every tick, forever, since idle cash sitting above the floor never stops
 * looking depositable. Idle cash simply accumulates as cash instead.
 *
 * A Strategy NEVER executes anything. It reads a snapshot and returns intents;
 * the runner pushes each intent through checkPolicy → simulate → execute.
 */

import type { TradeIntent } from "../policy";
import type { Snapshot } from "./types";

export type { Snapshot };

export interface BasketLeg {
  symbol: string;
  token: `0x${string}`;
  weightBps: number; // sums to 10_000 across legs
}

export interface SteadyBasketConfig {
  legs: BasketLeg[];
  buyPerTickUsdg: bigint;
  /** Idle USDG above this floor gets deposited to the vault. */
  idleFloorUsdg: bigint;
  /** The wall's one approved router — PancakeSwap's SwapRouter (see D008). */
  swapRouter: `0x${string}`;
  /** Undefined = no wall-approved vault to park idle cash in (the BSC default today). */
  vault?: `0x${string}`;
  usdg: `0x${string}`;
}

export function steadyBasketTick(cfg: SteadyBasketConfig, snap: Snapshot): TradeIntent[] {
  if (!snap.sequencerUp) return [];

  // Cash can't cover a buy but the vault can: pull enough back to fund the next
  // tick's buy plus the liquidity floor. Withdraw-only tick — buys resume next
  // tick once the cash has actually landed.
  if (cfg.vault && snap.cashUsdg < cfg.buyPerTickUsdg && snap.vaultUsdg > 0n) {
    const need = cfg.buyPerTickUsdg + cfg.idleFloorUsdg - snap.cashUsdg;
    const amountUsdg = need > snap.vaultUsdg ? snap.vaultUsdg : need;
    return [{ kind: "vault-withdraw", target: cfg.vault, amountUsdg }];
  }

  const intents: TradeIntent[] = [];

  if (snap.cashUsdg >= cfg.buyPerTickUsdg) {
    for (const leg of cfg.legs) {
      if (snap.pausedTokens.has(leg.token.toLowerCase())) continue;
      if (snap.staleFeeds.has(leg.symbol)) continue; // no reference price → no trade
      const legAmount = (cfg.buyPerTickUsdg * BigInt(leg.weightBps)) / 10_000n;
      if (legAmount === 0n) continue;
      intents.push({
        kind: "swap",
        target: cfg.swapRouter,
        sellToken: cfg.usdg,
        buyToken: leg.token,
        sellAmountRaw: legAmount,
        notionalUsdg: legAmount,
      });
    }
  }

  const idleAfterBuys = snap.cashUsdg - (intents.length ? cfg.buyPerTickUsdg : 0n);
  if (cfg.vault && idleAfterBuys > cfg.idleFloorUsdg) {
    const excess = idleAfterBuys - cfg.idleFloorUsdg;
    // Size the sweep to what the wall will actually take. A deposit is capped at
    // the DAILY limit (policy.ts), and this tick's buys have already eaten into
    // today's budget — so proposing the whole excess on a small grant meant the
    // deposit was rejected every single tick, forever, while the cash never moved.
    // Sweep what fits now; the rest goes next tick. Nothing here loosens a cap:
    // the proposal only ever shrinks.
    const spentOnBuys = intents.reduce(
      (sum, i) => sum + (i.kind === "swap" ? i.notionalUsdg : 0n),
      0n,
    );
    const headroom = snap.spendHeadroomUsdg - spentOnBuys;
    const amountUsdg = excess < headroom ? excess : headroom;
    if (amountUsdg > 0n) {
      intents.push({ kind: "vault-deposit", target: cfg.vault, amountUsdg });
    }
  }

  return intents;
}
