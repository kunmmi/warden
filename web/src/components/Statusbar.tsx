"use client";

import { useEffect, useState } from "react";
import { bscChain } from "@warden/core";

const RPC = bscChain.rpcUrls.default.http[0];

/**
 * Honest statusbar: chain health from the same heuristic the worker uses — a
 * healthy chain produces blocks continuously, so a latest-block timestamp
 * older than 120s reads as down. "checking" until the first read lands.
 * (BSC has no rollup sequencer — this checks block production directly.)
 */
export function Statusbar() {
  const [seq, setSeq] = useState<"checking" | "up" | "down">("checking");
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { version?: string } | null) => j?.version && setVersion(j.version))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getBlockByNumber",
            params: ["latest", false],
          }),
        });
        const j = await res.json();
        const ts = parseInt(j?.result?.timestamp ?? "0x0", 16);
        if (!alive) return;
        setSeq(Date.now() / 1000 - ts < 120 ? "up" : "down");
      } catch {
        if (alive) setSeq("down");
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <footer className="statusbar">
      <span className={seq === "up" ? "live" : seq === "down" ? "err" : "dim"}>
        ● chain {seq}
      </span>
      <span>pricing: PancakeSwap v3 TWAP · no Chainlink feeds in v0</span>
      <span>execution: paper only — no live wallet/venue wired up yet (v1)</span>
      <span>every trade simulated before it is signed</span>
      <span>{version && <span className="dim">v{version}</span>}</span>
    </footer>
  );
}
