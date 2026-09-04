import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Feedback",
  description: "How to shape warden's roadmap — no token, no tiers, just open issues and a direct line to whoever ships it.",
};

const CHANNELS: [string, string, string][] = [
  ["Feature ideas", "Open a GitHub issue describing what you want and why.", "https://github.com/kunmmi/warden/issues"],
  ["Bugs", "Same place — include your OS and what the CLI's doctor command printed.", "https://github.com/kunmmi/warden/issues"],
];

export default function GovernancePage() {
  return (
    <div className="wrap" style={{ maxWidth: 820, padding: "40px 24px 80px" }}>
      <article className="doc-body">
        <h1>Feedback</h1>
        <p className="doc-lead">
          warden doesn&apos;t have a token-gated governance system. There&apos;s no tier, no weighted
          vote, no perk for holding <Link className="link" href="/token">$WARDEN</Link> — feedback
          works the same for everyone.
        </p>

        <div className="callout">
          Roadmap decisions are made by whoever maintains the project, informed by what people actually
          ask for in the open. That&apos;s slower to formalize than a voting system, but it&apos;s
          honest about who&apos;s deciding — this page won&apos;t claim otherwise.
        </div>

        <h2>Where to say something</h2>
        <ul>
          {CHANNELS.map(([title, body, href]) => (
            <li key={title}>
              <strong>{title}</strong> — {body}{" "}
              <a className="link" href={href} target="_blank" rel="noreferrer">
                {href.replace("https://", "")}
              </a>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
