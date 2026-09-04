import Link from "next/link";
import { Logo } from "./Logo";
import { TokenCA } from "./TokenCA";

const GITHUB = "https://github.com/kunmmi/warden";

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <Link href="/" className="brand">
              <Logo size={20} />
              <span>warden</span>
            </Link>
            <p>Trading agents you never have to trust. Non-custodial on-chain trading: your keys, your caps, your machine.</p>
          </div>

          <div className="foot-col">
            <h5>Product</h5>
            <Link href="/#features">Features</Link>
            <Link href="/#telegram">Telegram</Link>
            <Link href="/#install">Install</Link>
            <Link href="/#safety">Safety model</Link>
          </div>

          <div className="foot-col">
            <h5>Docs</h5>
            <Link href="/docs">Getting started</Link>
            <Link href="/docs#wallet">Create a wallet</Link>
            <Link href="/docs#telegram">Set up Telegram</Link>
            <Link href="/docs#pc-control">PC control</Link>
            <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">Support</a>
          </div>

          <div className="foot-col">
            <h5>Project</h5>
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
            <Link href="/token">$WARDEN</Link>
            <Link href="/governance">Feedback</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>

        <TokenCA />

        <div className="foot-bottom">
          <span>© {new Date().getFullYear()} warden · MIT-licensed, open source</span>
          <span>
            Support: <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">open a GitHub issue</a> · Not financial advice. Trade at your own risk.
          </span>
        </div>
      </div>
    </footer>
  );
}
