import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Watch it trade",
  description: "Live, on-chain trade watching — coming soon for BNB Smart Chain.",
};

export default function Watch() {
  return (
    <section className="watch-page">
      <div className="wrap">
        <div className="section-head">
          <div className="tag" data-reveal="fade"><span className="n">—</span> coming soon</div>
          <h1 data-reveal="mask">Watch it trade.</h1>
          <p className="watch-lede" data-reveal="up">
            Every trade warden makes is a public transaction on BNB Smart Chain — anyone can already
            verify it in a block explorer today. This page, a live in-browser tape of any account, is
            being rebuilt for BSC and isn&apos;t ready yet.
          </p>
        </div>
        <div className="watch-notes">
          <h3>Want to check a trade right now?</h3>
          <p>
            Your dashboard links the account contract straight to the explorer — that works today,
            no need to wait on this page. See <Link className="link" href="/docs#wallet">the wallet docs</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}
