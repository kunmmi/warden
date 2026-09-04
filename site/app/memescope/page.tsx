import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Memescope",
  description: "New pools on BNB Smart Chain, newest first — coming soon.",
};

export default function Memescope() {
  return (
    <section className="scope-page">
      <div className="wrap">
        <div className="section-head">
          <div className="tag" data-reveal="fade"><span className="n">—</span> coming soon</div>
          <h1 data-reveal="mask">What just launched.</h1>
          <p className="watch-lede" data-reveal="up">
            A live feed of newly opened pools on BNB Smart Chain, read straight from the chain. This
            page is being rebuilt for BSC and isn&apos;t ready yet.
          </p>
        </div>
      </div>
    </section>
  );
}
