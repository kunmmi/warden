import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { Parallax } from "@/components/Parallax";
import { Marquee } from "@/components/Marquee";

const MARQUEE = [
  "Self-hosted", "Your keys, your caps", "On-chain permission wall", "LLM proposes, code disposes",
  "Telegram control", "Voice & vision", "Simulated before signed", "Kill switch", "Open source · MIT",
];

const GITHUB = "https://github.com/kunmmi/warden";

/**
 * The Windows installer, pinned to an exact asset — same rule as before:
 * this link is right or it is broken, never a silent download of the wrong
 * build. Bump both together when a new desktop build ships.
 */
const DESKTOP_VERSION = "0.1.10";
const DESKTOP_SIZE = "147 MB";
const WINDOWS_DOWNLOAD = `${GITHUB}/releases/download/desktop-v${DESKTOP_VERSION}/warden.Setup.${DESKTOP_VERSION}.exe`;

function Wordmark() {
  return (
    <div className="wordmark-wrap" aria-hidden>
      <Parallax speed={0.32}>
        <div className="wordmark">WARDEN</div>
      </Parallax>
    </div>
  );
}

const PROMISES: [IconName, string][] = [
  ["key", "Your keys, your caps"],
  ["shield", "Bounded worst case"],
  ["beaker", "Every trade simulated"],
  ["chart", "Fees only on profit"],
  ["ledger", "An honest scoreboard"],
];

const CAPS: [IconName, string, string][] = [
  ["cpu", "LLM strategist", "Bring any key — Groq, OpenAI, Anthropic, Gemini and more — and it proposes typed buy/sell/hold at decision windows; deterministic code validates and disposes. The model never sees an address."],
  ["calendar", "Built-in strategies", "steady-basket DCA, weekend-gap, even-keel, dip-hunter, or a hot-reloaded bot you write yourself — every strategy is free, none of them gated."],
  ["shield", "On-chain caps", "Per-trade, daily, ops/day, drawdown breaker, key expiry — enforced by the account contract on every operation."],
  ["beaker", "Simulate first", "Every swap gets a live quote before it is signed. Minimum-out is met, or nothing moves."],
  ["transfer", "Chat transfers", "Send funds out from Telegram — off by default, amount-capped on-chain, and always behind an explicit confirm."],
  ["ledger", "Honest scoreboard", "Rejections shown with the same weight as wins. A simulation receipt attached to every trade."],
  ["bell", "Proactive pings", "Trades landing, drawdown, gas and expiry warnings, your price alerts, a daily report at your hour."],
  ["eye", "Voice & vision", "Send a voice note; ask what is on your screen. Powered by your own Anthropic key."],
  ["power", "Kill switch", "One command destroys the grant; the worker stands down next tick. On-chain expiry is the backstop."],
];

const STEPS: [string, string, string][] = [
  ["1", "Install & open it", "The one-click app installs warden and opens your dashboard. No accounts, nothing to connect."],
  ["2", "Create your agent — it trades on paper instantly", "Pick a spending-limit preset and go. Your agent starts trading at real live BSC prices with pretend money, so you watch it work before risking a cent."],
  ["3", "Add a key to go live", "When you're ready, paste one free bundler key and the same agent trades for real — inside the exact same limits. Steer it from Telegram if you like."],
];

export default function Home() {
  return (
    <>
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-motif" data-reveal="fade">
            <Icon name="globe" size={46} />
          </div>
          <h1 className="hero-statement" data-reveal="mask">
            Trading agents you never have to trust.
          </h1>
          <p className="hero-sub" data-reveal="up" style={{ ["--d" as string]: "90ms" }}>
            warden is a trading bot you run yourself. It works BNB Smart Chain for you —
            but your keys stay on your machine, and the spending limits you set are enforced by the
            blockchain itself, so it can never spend more than you allow. Name it, chat with it, and
            steer it from Telegram.
          </p>
          <div className="hero-cta" data-reveal="up" style={{ ["--d" as string]: "170ms" }}>
            <span className="mag" data-magnetic>
              <Link href="/docs" className="btn btn-primary btn-lg has-box">
                Get started <span className="box"><Icon name="arrow" size={16} /></span>
              </Link>
            </span>
            {/* Deep-links the CURRENT installer, not the releases page, so a
                wrong or stale build is never one click away. See the note on
                WINDOWS_DOWNLOAD above. */}
            <a href={WINDOWS_DOWNLOAD} className="btn btn-ghost btn-lg">
              <Icon name="arrow" size={15} /> Download for Windows
            </a>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="btn btn-ghost btn-lg">
              View on GitHub
            </a>
          </div>
          <div className="hero-meta" data-reveal="up" style={{ ["--d" as string]: "240ms" }}>
            MIT-licensed · runs on your machine · no account, no cloud
            <br />
            <span style={{ opacity: 0.75 }}>
              Windows {DESKTOP_VERSION} · {DESKTOP_SIZE} · macOS and Linux via{" "}
              <a className="link" href="#install">the one-line install</a>
            </span>
          </div>
        </div>
        <Wordmark />
      </section>

      {/* ── promises ─────────────────────────────────────────────────────── */}
      <section style={{ paddingTop: 44, paddingBottom: 44 }}>
        <div className="wrap">
          <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {PROMISES.map(([, label], i) => (
              <div key={label} className="cell promise" data-reveal="up" style={{ ["--d" as string]: `${i * 70}ms` }}>
                <span className="promise-n">{String(i + 1).padStart(2, "0")}</span>
                <h4>{label}</h4>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── marquee band ─────────────────────────────────────────────────── */}
      <Marquee items={MARQUEE} />

      {/* ── the trust layer — load-bearing, everything rests on it ────────── */}
      <section id="safety">
        <div className="wrap">
          <div className="section-head">
            <div className="tag" data-reveal="fade"><span className="n">01</span> — the trust layer</div>
            <h2 data-reveal="mask">The wall is the product.</h2>
            <p data-reveal="up" style={{ ["--d" as string]: "80ms" }}>
              Anyone can ship a trading agent. The hard thing — the thing warden is — is an agent
              you don&apos;t have to trust: it runs on your machine, holds keys that never leave it,
              and trades inside caps the chain itself enforces. Everything else on this page is
              built on top of that wall.
            </p>
          </div>

          <div className="safety" data-reveal="up">
            <div className="quote">
              The rule of the house: <b>the model proposes, deterministic code disposes.</b>
            </div>
            <p>
              No strategist, Telegram message, or voice note ever constructs calldata, moves funds,
              or touches your PC without passing a closed, typed command set and — for money — the
              on-chain policy wall. Trades pass caps enforced by the account contract. Transfers are
              amount-capped and confirm-gated. PC actions are off by default, allowlisted, and
              confirmed. A prompt-injected “send everything to 0xevil” can at worst produce a
              confirmation card you will see and cancel.
            </p>
            <p>
              And you don&apos;t take our word for it: your dashboard shows the account contract,
              the session key, and every cap with explorer links — and a <b>prove the wall</b>{" "}
              button that fires malicious intents through the live policy so you can watch each one
              bounce.
            </p>
          </div>

          <div className="grid moat-grid">
            <div className="cell" data-reveal="up">
              <h4>Why not wait for a platform&apos;s own agent?</h4>
              <p>
                A first-party agent is custodial by construction: their servers, their keys, their
                discretion — the safety story is a terms-of-service. If the platform, its model, or
                its prompt gets compromised, so does your account. You trust; it trades.
              </p>
            </div>
            <div className="cell" data-reveal="up" style={{ ["--d" as string]: "80ms" }}>
              <h4>warden inverts it</h4>
              <p>
                The agent lives on your machine and holds a session key whose limits — how much per
                trade, how often, how long it lives, and <em>where value may land</em> — are
                enforced by your account contract on-chain, verifiable in the explorer. A
                compromised agent can trade inside that wall. It cannot send your funds to an
                address you never registered, and it cannot sign anything. You verify; it trades.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── features ─────────────────────────────────────────────────────── */}
      <section id="features">
        <div className="wrap">
          <div className="section-head">
            <div className="tag" data-reveal="fade"><span className="n">02</span> — what it is</div>
            <h2 data-reveal="mask">An agent that works BSC while you sleep.</h2>
            <p data-reveal="up" style={{ ["--d" as string]: "80ms" }}>
              The strategist proposes; deterministic code disposes. Nothing the model outputs — a
              trade, a transfer, a command — reaches your funds or your machine without passing a
              typed, closed command set and the on-chain policy wall.
            </p>
          </div>

          <div className="feature-row">
            <div className="feature-copy" data-reveal="up">
              <div className="feature-kicker">Self-hosted</div>
              <h3>Runs on your machine. Full stop.</h3>
              <p>
                One installer, a local dashboard, and a worker that trades on a schedule. No
                servers, no sign-up — your data and your keys live in
                <code className="inline">~/.warden</code> and never leave it.
              </p>
              <ul className="feature-list">
                {["Create a wallet in-browser — nothing to connect", "Caps enforced by the account contract on every op", "Testnet sandbox or real mainnet, you choose", "Kill switch destroys the grant, halts the agent"].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="mock" data-reveal="up" style={{ ["--d" as string]: "120ms" }}>
              <pre className="code" style={{ border: "none", borderRadius: 0, background: "transparent" }}>
{`~/.warden/
├─ settings.json     `}<span className="tok">{`# your knobs`}</span>{`
├─ grant.json        `}<span className="tok">{`# the signed wall`}</span>{`
├─ warden.db       `}<span className="tok">{`# the ledger`}</span>{`
├─ strategies/       `}<span className="tok">{`# your own bots`}</span>{`
└─ soul/             `}<span className="tok">{`# who your agent is`}</span>{`
   ├─ IDENTITY.md
   ├─ OWNER.md
   └─ JOURNAL.md`}
              </pre>
            </div>
          </div>

          <div className="feature-row flip">
            <div className="feature-copy" data-reveal="up">
              <div className="feature-kicker">Telegram</div>
              <h3>Run your agent from your phone.</h3>
              <p>
                Link a bot and chat with your agent in plain English or slash commands. Check the
                book, trade, transfer with a confirm, set price alerts, get a daily report — all
                inside the same permission walls. It even speaks first.
              </p>
              <ul className="feature-list">
                {["“how are we doing?” · “pause everything”", "Trade pings, drawdown & gas warnings, daily digest", "Transfers are triple-guarded and always confirmed", "Voice notes work too"].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="mock chat" data-reveal="up" style={{ ["--d" as string]: "120ms" }}>
              <div className="msg me">how are we doing today?</div>
              <div className="msg bot">Up <b>+$14.20</b> (+2.1%) · WBNB is your best holding. Two arrows loosed, both landed. Quiet and green.</div>
              <div className="msg me">buy 20 usdt of cake</div>
              <div className="msg bot">Submitted buy 20 USDT CAKE — watch <span className="mono">/trades</span>. Passed the policy wall.</div>
            </div>
          </div>

          <div className="feature-row">
            <div className="feature-copy" data-reveal="up">
              <div className="feature-kicker">Remote control</div>
              <h3>It can run your PC, too.</h3>
              <p>
                Screenshots, “what am I looking at?”, open apps, browse files, allowlisted shell,
                keystrokes, reminders and watchers — from Telegram. Off by default, one capability at
                a time, sharp edges always behind a confirm.
              </p>
              <ul className="feature-list">
                {["Screenshot & vision · open apps and URLs", "Allowlisted shell · type & hotkeys", "“ping me when my build finishes”", "Every sharp action needs an explicit confirm"].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="mock chat" data-reveal="up" style={{ ["--d" as string]: "120ms" }}>
              <div className="msg me">what am I looking at?</div>
              <div className="msg bot">A failing test in <span className="mono">policy.test.ts</span> — the daily-cap assertion expected 500 but got 525. Off-by-one in the reserve.</div>
              <div className="msg me">run npm test</div>
              <div className="msg bot">Confirm run <span className="mono">npm test</span> — /confirm or /cancel.</div>
            </div>
          </div>

          <div className="feature-row flip">
            <div className="feature-copy" data-reveal="up">
              <div className="feature-kicker">The soul</div>
              <h3>Your agent is an individual.</h3>
              <p>
                Give it a name. It keeps its own markdown files, learns who you are, writes a journal
                at report time, and grows warmer the longer you work together — from new companion to
                trusted companion. Memory is context, never capability.
              </p>
              <ul className="feature-list">
                {["“I'll call you Scout” — it's named", "It remembers your preferences from conversation", "Milestones at a week, a month, a hundred days", "Read or edit its soul with any editor"].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="mock chat" data-reveal="up" style={{ ["--d" as string]: "120ms" }}>
              <div className="msg me">/soul</div>
              <div className="msg bot">
                <b>Warden</b> · trusted companion · 22 days riding with you, 27 messages shared. I
                know you trade small and check in before work. My soul lives in
                <span className="mono"> ~/.warden/soul/</span>.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── capability grid ──────────────────────────────────────────────── */}
      <section style={{ paddingTop: 40 }}>
        <div className="wrap">
          <div className="section-head center">
            <div className="tag" style={{ justifyContent: "center" }} data-reveal="fade"><span className="n">03</span> — the toolkit</div>
            <h2 data-reveal="mask">Everything, gated by design.</h2>
          </div>
          <div className="grid">
            {CAPS.map(([ic, t, d], i) => (
              <div key={t} className="cell" data-reveal="up" style={{ ["--d" as string]: `${(i % 3) * 80}ms` }}>
                <div className="cell-ic"><Icon name={ic} size={26} /></div>
                <h4>{t}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── install ──────────────────────────────────────────────────────── */}
      <section id="install">
        <div className="wrap">
          <div className="section-head center">
            <div className="tag" style={{ justifyContent: "center" }} data-reveal="fade"><span className="n">04</span> — quickstart</div>
            <h2 data-reveal="mask">Up and running in three steps.</h2>
            <p data-reveal="up" style={{ ["--d" as string]: "80ms" }}>Install, create an agent, watch it trade on paper. Real money is optional and comes later.</p>
          </div>

          <div data-reveal="up" style={{ maxWidth: 780, margin: "0 auto 22px", textAlign: "center" }}>
            <span className="mag" data-magnetic>
              <a href={WINDOWS_DOWNLOAD} className="btn btn-primary btn-lg has-box">
                Download for Windows <span className="box"><Icon name="arrow" size={16} /></span>
              </a>
            </span>
            <p className="install-note" style={{ marginTop: 12 }}>
              <b>The one-click app</b> — double-click to install, no terminal, no Node. Dashboard +
              agent, with a tray icon to pause or quit. Windows {DESKTOP_VERSION} · {DESKTOP_SIZE}.{" "}
              <span style={{ opacity: 0.72 }}>
                Unsigned for now, so Windows SmartScreen shows a warning → <b>More info → Run anyway</b>.
                On macOS / Linux, use the command-line install below.
              </span>
            </p>
          </div>

          <div style={{ maxWidth: 780, margin: "0 auto 20px" }}>
            <pre className="code">
{`# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/kunmmi/warden/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/kunmmi/warden/main/install.ps1 | iex`}
            </pre>
          </div>
          <p className="install-note" data-reveal="up">
            Runs on <b>Linux, macOS, and Windows</b> — no Docker, no clone. The installers set up
            Node for you. Your agent starts in <b>paper mode</b> (live BSC prices, simulated fills,
            zero funds), so you can watch it trade in a couple of minutes.
          </p>

          <div className="steps">
            {STEPS.map(([n, t, d], i) => (
              <div key={n} className="step" data-reveal="up" style={{ ["--d" as string]: `${i * 70}ms` }}>
                <div className="num">{n}</div>
                <h4>{t}</h4>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── telegram walkthrough ─────────────────────────────────────────── */}
      <section id="telegram" style={{ paddingTop: 40 }}>
        <div className="wrap">
          <div className="feature-row" style={{ borderTop: "none", paddingTop: 0 }}>
            <div className="feature-copy" data-reveal="up">
              <div className="tag"><span className="n">05</span> — two minutes</div>
              <h3 style={{ marginTop: 18 }}>Set up Telegram</h3>
              <ol style={{ paddingLeft: 20, color: "var(--text-dim)", marginTop: 18, lineHeight: 1.9, fontSize: 15.5 }}>
                <li>Message <strong>@BotFather</strong> → <code className="inline">/newbot</code> → copy the token</li>
                <li>Dashboard → <strong>Settings → Telegram</strong> → paste, test, enable</li>
                <li>Message your bot <code className="inline">/link &lt;code&gt;</code> — you&apos;re the owner</li>
                <li>Say “how are we doing?” — you&apos;re chatting with your agent</li>
              </ol>
              <p style={{ marginTop: 22 }}>
                <Link href="/docs#telegram" className="btn btn-ghost has-box">
                  Full Telegram guide <span className="box"><Icon name="arrow" size={15} /></span>
                </Link>
              </p>
            </div>
            <div className="mock chat" data-reveal="up" style={{ ["--d" as string]: "120ms" }}>
              <div className="msg me">/link 5HDE9E</div>
              <div className="msg bot">You&apos;re linked — you now command this agent. Try /status.</div>
              <div className="msg me">/status</div>
              <div className="msg bot">
                <b>Warden — status</b><br />
                • worker: alive · chain: BSC mainnet 56<br />
                • strategy: steady-basket · venue: pancakeswap<br />
                • caps: 50/trade · 500/day · breaker 13%
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── final CTA ────────────────────────────────────────────────────── */}
      <section className="cta">
        <div className="wrap">
          <h2 data-reveal="mask">Deploy your agent.</h2>
          <p data-reveal="up" style={{ ["--d" as string]: "80ms" }}>Free, open source, and yours. Install it, name your agent, watch the first trade land.</p>
          <div className="hero-cta" data-reveal="up" style={{ marginTop: 30, ["--d" as string]: "150ms" }}>
            <span className="mag" data-magnetic>
              <Link href="/docs" className="btn btn-primary btn-lg has-box">
                Read the docs <span className="box"><Icon name="arrow" size={16} /></span>
              </Link>
            </span>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="btn btn-ghost btn-lg">
              GitHub
            </a>
          </div>
        </div>
        <Wordmark />
      </section>
    </>
  );
}
