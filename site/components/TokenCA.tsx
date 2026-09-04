"use client";

import { useState } from "react";
import { WARDEN_TOKEN_ADDRESS, BSCSCAN_TOKEN_URL } from "@/lib/token";

/**
 * The $WARDEN token contract address, verifiable on-chain — once it's
 * deployed. Factual only: no price, no "buy", no returns; the footer already
 * carries the not-financial-advice line. Never fabricate an address here —
 * see lib/token.ts.
 */
export function TokenCA() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!WARDEN_TOKEN_ADDRESS) return;
    try {
      await navigator.clipboard.writeText(WARDEN_TOKEN_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — the address is selectable inline */
    }
  };

  if (!WARDEN_TOKEN_ADDRESS) {
    return (
      <div className="token-ca">
        <span className="token-ca-label">
          <b>$WARDEN</b> token · BNB Smart Chain
        </span>
        <span className="token-ca-addr" style={{ opacity: 0.7 }}>
          not deployed yet — check back at launch
        </span>
      </div>
    );
  }

  return (
    <div className="token-ca">
      <span className="token-ca-label">
        <b>$WARDEN</b> token · BNB Smart Chain
      </span>
      <code className="token-ca-addr" title={WARDEN_TOKEN_ADDRESS}>{WARDEN_TOKEN_ADDRESS}</code>
      <button type="button" className="token-ca-btn" onClick={copy}>
        {copied ? "copied ✓" : "copy"}
      </button>
      <a className="token-ca-btn" href={BSCSCAN_TOKEN_URL(WARDEN_TOKEN_ADDRESS)} target="_blank" rel="noreferrer">
        explorer ↗
      </a>
    </div>
  );
}
