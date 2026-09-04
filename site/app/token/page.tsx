import type { Metadata } from "next";
import { TokenCA } from "@/components/TokenCA";

export const metadata: Metadata = {
  title: "$WARDEN",
  description:
    "$WARDEN is a community token for the warden trading agent. Fixed supply, no owner, no mint function — no utility promised. Verify it yourself on-chain.",
};

export default function TokenPage() {
  return (
    <div className="wrap" style={{ maxWidth: 820, padding: "40px 24px 80px" }}>
      <article className="doc-body">
        <h1>$WARDEN</h1>
        <p className="doc-lead">
          A community token for warden — and, just as importantly, what it isn&apos;t.
        </p>

        <div className="callout">
          <strong>warden is free and open to everyone, whether you hold $WARDEN or not.</strong> The
          token confers no perks, no fee discount, no governance weight, and no share of anything the
          agent earns. It doesn&apos;t gate any feature of the software. It is a community coin, full
          stop — no utility is promised, implied, or planned.
        </div>

        <h2>What it is</h2>
        <p>
          $WARDEN is a plain, fixed-supply BEP-20 token on BNB Smart Chain. The entire supply is minted
          once, at deploy, to the deployer — after that there is no mint function, no owner, no fee on
          transfer, no blacklist, no pause. Anyone can read the full contract source themselves; there
          is nothing else in it to describe.
        </p>

        <h2>What it isn&apos;t</h2>
        <ul>
          <li>Not an investment, and no return is promised or implied.</li>
          <li>Not a claim on warden&apos;s trading activity, fees, or profit.</li>
          <li>Not a key to any feature — the software is the same whether you hold it or not.</li>
          <li>Not launched through a third-party platform — it&apos;s a self-deployed contract you can verify line by line.</li>
        </ul>

        <h2>The token, on-chain</h2>
        <p>
          $WARDEN lives on BNB Smart Chain — the same chain the agents trade on. Verify it yourself,
          not on our word:
        </p>
        <div style={{ margin: "16px 0 8px" }}>
          <TokenCA />
        </div>

        <div className="callout danger" style={{ marginTop: 32 }}>
          Nothing here is financial advice or a solicitation to buy anything. $WARDEN is a community
          token with no promised utility; it is not an investment, and no return is promised or
          implied. Digital assets are volatile and can lose all value.
        </div>
      </article>
    </div>
  );
}
