<p align="center">
  <img src="web/public/wardenlogo.png" alt="warden — autonomous trading agents for BNB Smart Chain" width="360" />
</p>

<p align="center">
  <a href="https://github.com/kunmmi/warden"><b>Repo</b></a> ·
  <a href="https://github.com/kunmmi/warden/releases">Releases</a> ·
  <a href="https://github.com/kunmmi/warden/issues">Issues</a>
</p>

# warden

**Trading agents you never have to trust.** warden is a self-hosted band of
agents for **BNB Smart Chain**: your keys never leave your machine, and every cap
you set — per-trade, daily, ops/day, drawdown, key expiry — is enforced by your
account contract **on-chain**, not by promises. Inside that wall your band rides
24/7 — trading a curated basket on PancakeSwap v3 — while you name your merryman,
chat with it and steer it from Telegram (it can even run your PC), and watch every
trade on a local dashboard.

**The five promises:** your keys, your caps · bounded worst case · every trade
simulated first · fees only on profit above the high-water mark · an honest
scoreboard.

**The one rule of the house:** the model proposes, deterministic code disposes.
No model — the strategist, a Telegram message, a voice note — ever constructs
calldata, moves funds, or touches your PC without passing a closed, typed
command set and the on-chain policy wall. This is the product; everything below
is built on top of it.

## Why warden — the moat

Anyone can ship a trading agent, and platforms will ship their own. A
first-party agent is **custodial by construction**: their servers, their keys,
their discretion — the safety story is a terms-of-service. warden inverts it:

- **Your machine.** The agent, its memory, and its ledger live in `~/.warden`.
  There is no server-side anything.
- **Your keys.** Minted locally, backed up by you, never transmitted.
- **The chain enforces the caps.** The session key's limits live in the account
  contract (ERC-4337, Kernel v3.3); even a fully compromised agent cannot spend
  past the wall.
- **Verifiable, not claimed.** The dashboard links every address and cap to
  BscScan, and its **prove the wall** button fires a battery of malicious intents
  (an oversized trade, a "send everything to 0xdEaD" transfer, an unknown venue,
  a spent daily budget, an expired key, a tripped drawdown) through the *same*
  deterministic policy code the worker runs on every tick — the exact mirror of
  the caps your account contract enforces — so you can watch each one bounce.
  Nothing is signed and nothing touches the chain.

You verify; it trades.

---

## The workflow, end to end

1. **Install** it (one line — installs Node too if you need it).
2. **`warden start`** — opens the dashboard at `localhost:3100` and looses the
   24/7 worker.
3. **Create your agent wallet** at `/grant` — no wallet to connect; warden
   mints the keys, you back them up, pick **testnet** (practice) or **mainnet**
   (real funds), and set the caps the account contract itself enforces.
4. **Fund it** — on **mainnet**, send BNB (gas) + USDT (capital) to the account
   address. On **testnet**, gas from the faucet and nothing else: USDT sent there
   is never shown and never traded. The worker arms itself on its next tick, no
   restart.
5. **(optional) Link Telegram** — chat with your merryman, give it a name, let it
   trade, report, alert, and control your PC — all inside the same walls.

Everything lives in **`~/.warden`** (`settings.json`, `grant.json`, `warden.db`,
your strategies, your merryman's soul). The install is disposable; upgrades never
touch your data.

> **A naming leftover.** The cash leg is **USDT on BSC**
> (`0x55d3…7955`, **18 decimals** — not the 6 you may expect from other chains).
> Parts of the UI, the Telegram help text and the settings keys still spell it
> `usdg`, inherited from the chain this project was forked off. Same token, older
> label; it is being cleaned up.

**Ride in 2 minutes — paper mode.** Until you add a bundler key, your band trades
in **paper mode**: approved intents fill at *live* on-chain prices (the guarded
PancakeSwap v3 TWAP — see below), minus configured slippage as honest friction,
recorded to the real ledger as paper trades. The whole loop — the strategist,
chat `/buy`, P&L, pings, the journal — works with zero funds, zero faucet, zero
Pimlico. Add a Pimlico key and the same wall signs for real. Upgrade any time
with `warden update` (stops the band, installs, restarts — no Windows file-lock).

---

## 1 · Install

Self-hosted, terminal-first. Install once, run from anywhere. No clone.

**No Node yet? One line does everything** — installs Node if missing, then
warden, and puts it on PATH:

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/kunmmi/warden/main/install.ps1 | iex
```
```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/kunmmi/warden/main/install.sh | bash
```

**Already have Node 22.12+?**

```bash
npm install -g github:kunmmi/warden   # install from the repo — see the warning below
warden setup                          # checks node / npm / PATH, prints exact fixes
warden onboard                        # optional wizard: Pimlico key, strategy, basket (all skippable)
warden start                          # dashboard at localhost:3100 + the worker
```

> ⚠️ **Install from the repo, never from the npm name.** Nothing is published to
> npm under a warden-owned name. `npm i -g warden` installs an **unrelated
> stranger's package**, and `npm i -g merrymen` installs the upstream project
> this was forked from — neither is this software. `github:kunmmi/warden` (or the
> one-liners above) is the only correct install, and for the same reason there is
> no `npx` shortcut to recommend.

Requires **Node 22.12+**. `warden setup` diagnoses the two things that trip people
up — an old Node, and npm's global-bin folder missing from PATH.

> **`warden: command not found`?** npm's global-bin folder isn't on PATH. Add it
> once:
> - **Windows:** `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$env:APPDATA\npm", "User")` then reopen the terminal
> - **macOS/Linux:** put `$(npm prefix -g)/bin` on your `PATH` (in `~/.zshrc` / `~/.bashrc`)

> **Windows: `running scripts is disabled on this system` / `PSSecurityException`?**
> PowerShell's default `Restricted` policy blocks npm's and warden's `.ps1`
> shims. The installer relaxes it for you; if you installed earlier, run once
> (no admin, current user only): `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
> Or just call `warden.cmd …` (or use cmd.exe / Git Bash) to skip the policy.

**Rather not use a terminal at all?** There's a one-click **Windows desktop app**
that bundles Node, boots the worker + dashboard, and opens it in a native window:
[`warden.Setup.0.1.10.exe`](https://github.com/kunmmi/warden/releases/tag/desktop-v0.1.10).
Closing the window keeps the agent running in the system tray; only **Quit**
stops it.

The dashboard binds to **localhost only** — it has no login and holds your
trading controls, so it isn't reachable from your network. To open it to a
trusted LAN (your phone on home WiFi), start with
`WARDEN_HOST=0.0.0.0 warden start`.

---

## 2 · Create & fund your agent wallet

Open `localhost:3100/grant`. There's nothing to connect — warden generates a
fresh account, shows you the owner key to **back up** (lose it and the funds are
gone), and lets you fund it. **Pick your ground:**

- **testnet · 97** (default) — the sandbox. Free **gas (tBNB)** from the
  [BNB Chain faucet](https://www.bnbchain.org/en/testnet-faucet), and the grant,
  the caps, the policy checks and the journal all run for real. Two things don't:
  the token registry is mainnet-only, so **any USDT you send to testnet reads as 0
  and is never used**, and the trading venues aren't deployed there, so swaps
  no-route by design. Send gas, not capital — paper mode is already trading a
  simulated book at live prices.
- **mainnet · 56** — **real funds.** Real USDT, real BEP-20 tokens, real
  execution. The page makes you acknowledge it first: keys are generated and
  stored **in plain text on your machine**, so treat the account like a hot
  wallet — your caps are the seatbelt, start small. No faucet: send BNB (gas) +
  USDT (capital) from your own wallet or an exchange.

The caps you set — per-trade, daily, ops/day, drawdown breaker, key expiry — are
enforced **by the account contract on every operation**, not by promises. The
worker can tighten within them but can never widen them without a new signed
grant.

> **Going live is one key.** To sign real trades, paste a free [Pimlico](https://dashboard.pimlico.io)
> API key in `/settings` — warden builds the bundler URL from your grant's own
> chain id, so it can never point at the wrong one. No key = **paper mode**:
> real market, full policy + simulation, no signing. Advanced users can still
> supply a full bundler URL instead.

---

## 3 · Run it

```bash
warden start      # dashboard (localhost:3100) + the 24/7 worker
warden doctor     # node / keys / RPC / bundler / grant / db diagnostics
warden status     # heartbeat, grant, trades, equity
warden selftest   # one policy-legal no-op through the full pipeline
warden wallets    # every wallet on this machine (live + archived) + balances
warden kill       # kill switch from the terminal (destroys the grant)
warden recover    # sweep the account's funds to a wallet you control
```

> **Getting your funds back out.** The address you funded is an ERC-4337 **smart
> account**, not a plain wallet — its owner key derives a *different* address, so
> importing that key into MetaMask shows an empty wallet, not your funds (this
> trips everyone up once). To move money out — including after a kill switch —
> run **`warden recover`**: it rebuilds the account from your owner key (or a
> backed-up key you paste) and sweeps every balance to any address you choose in
> one signed op. It needs a bundler key, same as live trading.

> **Getting a funded wallet back — without moving anything.** Killed the agent,
> wiped the browser, or moved machines? Your smart-account address is derived from
> the **owner key**, so the same key always reproduces the same account, funds and
> all. Two ways back in:
>
> 1. **Still on the same browser?** `/grant` shows *"this wallet isn't active"* —
>    hit **re-arm this wallet**. One click, no key needed.
> 2. **Fresh browser / new machine?** `/grant` → **restore a funded wallet** →
>    paste your owner key → **check this wallet** (it shows the derived address and
>    its balance so you can confirm it's the right one) → pick caps → restore. It
>    signs a brand-new session key on your existing account. **No funds move, no
>    gas is spent.**
>
> warden runs **one agent per install**. To run two funded wallets at once, give
> each its own `WARDEN_HOME` (e.g. `WARDEN_HOME=~/.warden-b warden start`).

The worker's loop each tick: **grant sync → market safety (prices, pauses,
liveness) → strategy proposes → policy check → quote simulation → execute →
record**. It re-reads `~/.warden/settings.json` every tick, so changes from the
dashboard apply within one tick — connection changes re-arm the executor,
strategy changes rebuild in place; no restart. The dashboard shows live
positions, the trade record (with simulation receipts), the event feed, and a
kill switch; the scoreboard is at `/scoreboard`.

---

## 4 · Chat with your merryman (Telegram)

Link a bot and run the band from your phone — natural-language chat plus slash
commands, all inside the same permission walls. Telegram is a **control surface,
never a trade path**: every message is untrusted text that flows through the same
parse → validate → policy wall → signed grant discipline as the strategist.

```
1. @BotFather → /newbot → copy the token
2. localhost:3100/settings → Telegram → paste token, "test connection", enable
3. Message your bot:  /link <code>   (the one-time code shown in /settings)
   → you're now the owner; only allowlisted chats are obeyed
```

There's an obvious **Chat on Telegram** button right on the dashboard (topbar +
a card) so you don't have to hunt for it.

Commands work bare; with **any** AI provider key set in Settings, plain English
does too ("how are we doing?", "pause everything", "send 20 USDT to 0x…", "ping
me when BNB hits 900", "why did you buy that?"). Voice notes work as well.

| command | does |
|---|---|
| `/status` `/positions` `/pnl` `/trades` | read the live book |
| `/report` · `/brag` · `/why` | daily campfire report · shareable scorecard · explain the last trade |
| `/buy <SYM> <usdt>` `/sell <SYM> <usdt>` | trade (passes the policy wall) |
| `/transfer <0x…> <usdt>` | send USDT out — **always asks you to `/confirm`** |
| `/alert <SYM> > <price>` `/alerts` `/unalert <n>` | one-shot price alerts |
| `/pause` `/resume` · `/strategy <name>` · `/cap <usdt>` | steer the worker (cap only tightens) |
| `/name <name>` · `/soul` · `/remember <fact>` · `/forget` | name it, see who it is, teach it about you |
| `/wallet` | create, restore or recover a wallet (points you at the dashboard) |
| `/kill` | destroy the grant, stand the band down |
| `/help` | the full list |

**It speaks first, too** (toggle in `/settings`): a ping the moment a trade lands
or the wall turns one back; warnings when the grant nears expiry, drawdown nears
the breaker, or gas runs low; your price alerts; and a **daily campfire report**
at the hour you pick.

**Transfers are triple-guarded:** off by default · the grant's on-chain call
policy caps the amount · every transfer echoes the full recipient address and
waits for an explicit `/confirm`. A prompt-injected "send everything to 0xevil"
can at worst produce a confirmation card you'll see and `/cancel`. Turn off all
state-changing commands with the **control** toggle for read + chat only.

### Remote control — your merryman runs your PC

Enable the **remote control** section in `/settings` and your merryman can act on
the machine it runs on, from Telegram:

| capability | what it does |
|---|---|
| 📸 screen · 👁️ vision | `/shot` a screenshot; `/look` — "what am I looking at? / read this error" (**needs an Anthropic key**) |
| 🚀 apps & web | `/open spotify`, `/open github.com` — allowlisted apps, any URL |
| ⚙️ system | `/sys` info, volume, media keys, `/notify`, `/lock` |
| 📂 files · 📋 clipboard | `/ls`, `/get` inside one folder you pick; read/set the clipboard |
| 🖥️ shell · ⌨️ keyboard | `/run` allowlisted commands; `/type`, `/key ctrl+s` |
| 🎙️ voice · 👀 watchers | voice note → command; `/remind 20m …`, `/watch cpu>80`, `/watch file …`, `/watch proc …` |
| 🤖 agent | `/agent <task>` — works your PC in steps until done; say "stop" to halt |

**The safety model is the point** — it's a hot wallet for your desktop:

- **Off by default**, then **one capability at a time** — nothing runs unless you
  turned that group on. `/pc` shows what's enabled; the master switch off kills
  all of it instantly.
- **Allowlists for the sharp edges**: shell runs *only* your exact pre-approved
  commands (chaining/redirects always refused); files are confined to one root
  (no `..` escape); apps to a name list.
- **Confirm gate**: shell, keyboard, file-send, and power never fire until you
  reply `/confirm` to the exact action echoed back.
- **Local + logged**: a chat message can only ever emit one command from a closed
  set — it can't invent a capability or smuggle a raw command past the allowlist.

Windows is fully supported; macOS/Linux use the standard tools (`screencapture`,
`open`, `pbcopy`, …) and say so where one isn't present. Voice needs an
OpenAI-compatible transcription key (set it in the dashboard).

### Your merryman has a soul

Every merryman is an individual with a name **you** give it — and it grows with
you. Its soul lives as plain markdown in **`~/.warden/soul/`** that it keeps up
to date itself (read or edit it with any editor):

| file | what it holds |
|---|---|
| `IDENTITY.md` | who it is — its name (`/name Will Scarlet`), born date |
| `OWNER.md` | what it's learned about **you**, one dated line at a time |
| `JOURNAL.md` | a first-person entry it writes at campfire time |

The longer you ride together, the closer the bond — earned by **time and by
conversation**: *new companion* → *trusted companion* → *old friend* → *sworn
brother-in-arms*, with milestone messages and a tone that warms to match. Memory
is **context, never capability** — soul files flavor chat only; every command
still passes the closed enum and the policy wall, and the memory sanitizer
refuses anything address-, key-, or code-shaped, so a poisoned note can't smuggle
a recipient into a prompt.

---

## Strategies

All builtin strategies are **free and open to everyone**. Pick one in `/settings`
(or `/strategy <name>` from Telegram; `WARDEN_STRATEGY` is the headless
fallback):

| name | what it does |
|---|---|
| `steady-basket` (default) | DCA a weighted basket per tick. Idle cash simply accumulates — there is no verified BSC yield vault and the wall grants no vault permission |
| `weekend-gap` | Enters a leg when its Chainlink feed goes stale (market closed) and exits when it refreshes. **Inert on BSC today:** none of the basket tokens has a Chainlink feed wired, so it proposes nothing — it's carried over from the tokenized-equity design this project was forked from |
| `llm-strategist` | The model proposes typed buy/sell/hold at decision windows; deterministic code validates and disposes — it never sees an address or emits calldata. Needs any AI provider key; with none, it runs an honest no-op |
| `trencher` | Newly launched tokens: an entry **filter** with an exit discipline over chain-read signals (depth, FDV, age, drawdown, liquidity drain). Not alpha — the scout budget is the risk control. **Known gap:** pricing reads v3 pools only, and most launches are on PancakeSwap v2, so it refuses the large majority of what discovery finds |
| `even-keel` | Keeps the basket at equal weight — trims winners, tops up laggards — to harvest mean reversion |
| `dip-hunter` | Concentrates each tick on the basket token furthest below its rolling high |

The shipped basket is deliberately narrow: **WBNB, CAKE, BTCB, ETH** are the
tradable set, and a fresh agent starts with **WBNB** only. There is no BSC
equivalent of tokenized equities, so there is no stock/ETF registry here — you
widen the basket yourself in `/settings`.

### Write your own

Your strategies live in **`~/.warden/strategies/`** — hot-reloaded on save,
crash-isolated, and incapable of exceeding the caps you signed (every intent
passes shape validation → the policy wall → quote simulation → the on-chain
session key):

```bash
warden strategy new my-bot       # commented template in ~/.warden/strategies
# edit it, select "my-bot" in /settings — done
```

Default-export `{ name, tick(snapshot, ctx) }` — no imports needed; `ctx` injects
the verified registry (`ctx.tokenBySymbol.WBNB`, `ctx.CASH.USDT`,
`ctx.PANCAKESWAP.swapRouter`, `ctx.usdg(10)`). PancakeSwap is the only venue
exposed, because it is the wall's only approved spender — an intent naming
anything else is refused before it goes anywhere. See
[strategies/README.md](./strategies/README.md) and
[strategies/example-dip-buyer.mjs](./strategies/example-dip-buyer.mjs).

### Adding your own tokens (memecoins)

The built-in registry is the four curated, deep-pool tokens above. Anything else
on BSC you add yourself in `/settings`: paste the symbol, the contract address,
and its decimals.

**How they're priced.** None of these carry a Chainlink feed, so warden reads the
PancakeSwap v3 pool — but a spot price on a thin pool is worth nothing: anyone
with moderate capital can push it for a block, and that number would feed your
equity, your P&L and your drawdown breaker. So:

- **Valuation uses a 15-minute TWAP**, not spot (spot is used only to size a
  swap). Moving the TWAP means holding the price away from the market for the
  whole window and eating the arbitrage.
- **Two guards, both yours to set.** A minimum pool depth (default **$25,000**)
  and a maximum spot-vs-TWAP gap (default **5%**).
- **A refusal is the feature.** When a pool is too thin, has no usable TWAP, or
  is being pushed right now, the token stays *unpriced* and warden says why. Your
  agent keeps trading — you can always sell out — but equity, P&L and the breaker
  pause rather than running on a number nobody should trust.
- **Two hops where there's no direct pair.** A token with no direct `TOKEN/USDT`
  pool may still be reachable via WBNB, so the route becomes `USDT → WBNB →
  TOKEN`. Depth is judged on the *shallower* leg — a deep WBNB/USDT pool doesn't
  make a thin memecoin pool safe. The router holds the middle leg, so this needs
  no extra approval and no extra re-sign.

Anything valued this way is marked **pool px** in the dashboard and in `/status`,
because it isn't the same quality of claim as an external feed and shouldn't look
like one.

Three explicit steps, and each one means something different:

1. **Add it** in `/settings` — "know about this." Your agent reads the balance,
   prices it, and shows it in your book. It does not trade it.
2. **Select it in the basket** — "trade this."
3. **Re-sign at `/grant`** — the tradable list is baked into the session key you
   signed, so widening it takes a signature. That's the wall doing its job, not a
   bug. Free, instant, same wallet, same address, same funds, same caps.

Until step 3, `/settings`, `/grant` and the event feed all say plainly which
tokens your key can't sell — you never find out from a reverted trade.

### Keep it running

```bash
warden service install
```

Starts your merryman when you log in, and brings it back after a reboot. On
Windows it uses Task Scheduler where it can and the Startup folder where that
would need admin — a trading agent shouldn't be asking for elevation. macOS gets
a launchd agent, Linux a `systemd --user` unit with lingering enabled. All
user-scoped, all removed completely by `warden service uninstall`, and
`warden doctor` tells you whether it's installed *and* whether it's actually
running — those are different questions.

**What it does not do: run while the computer is off.** Nothing does except a
machine that stays on. If you want that, it's your own always-on box — we're not
going to hold your keys to do it for you.

### Never a position you can't exit

Buying spends USDT, and every grant can approve USDT generically. **Selling needs
a per-token approval sealed into your signature.** So a token with a live pool but
no approval would buy fine and could never be sold — the exit reverts, with your
money inside it.

warden refuses the buy. If your key can't sell something, it won't buy it, and
it tells you which symbols and why. A missed trade is recoverable; a position with
no way out is not. Re-sign at `/grant` to widen the list.

This is why the shipped allowlist is verified in **both directions** against live
pools — re-check it yourself any time:

```bash
npx tsx scripts/probe-tradability.mts
```

---

## For developers

<details>
<summary>repo layout · clone-dev · env vars · tests</summary>

### Layout
- `packages/core` — chain constants, token registry, the wall definition, shared
  types. Every address is probed on-chain before it lands here.
- `web` — Next.js dashboard: onboarding, the create-wallet/grant flow, live
  positions, trade record (simulation receipts), kill switch, scoreboard,
  settings + all APIs.
- `worker` — Node runtime: grant sync → scheduler → strategy tick → policy check
  → simulate → execute → record; the Telegram bridge + PC-control layer; the
  backtest harness (`src/backtest.ts`) that runs real strategies through the real
  policy layer over synthetic prices.
- `desktop` — the Electron one-click app (bundles Node, tray control).
- `contracts` — the on-chain drawdown breaker: `BreakerRegistry` +
  `KernelBreakerPolicy` (Kernel v3 module type 5 — fails every UserOp once
  tripped). `npm run test:contracts`; deployment waits on a funded key. Until
  deployed, the breaker is worker-enforced.

### Develop from a clone
```bash
git clone https://github.com/kunmmi/warden && cd warden
npm install          # prepare hook builds the dashboard
npm run onboard && npm start
# or run halves separately: npm run dev:web · npm run dev:worker
npm run typecheck && npm test
```

### Configuration
The dashboard `/settings` is the source of truth (AI provider + key, Telegram
keys, bundler + RPC URLs, strategy + every trading knob, the Telegram +
PC-control toggles and allowlists). Saved to `~/.warden/settings.json`; secrets
are masked to their last 4 and never echo back to the browser. Precedence:
**settings file > env var > default.** Env vars are the headless fallback:

| var | default | meaning |
|---|---|---|
| `WARDEN_HOME` | `~/.warden` | where all user data lives; the install stays disposable |
| `WARDEN_HOST` | `127.0.0.1` | dashboard bind host; set `0.0.0.0` for trusted-LAN access |
| `WARDEN_BUNDLER_API_KEY` | — | Pimlico API key; the bundler URL is built for your grant's chain automatically |
| `WARDEN_BUNDLER_URL` | — | advanced: full 4337 bundler RPC (overrides the key); without either, nothing signs |
| `WARDEN_RPC_MAINNET` / `WARDEN_RPC_TESTNET` | — | override the default BSC RPCs |
| `WARDEN_STRATEGY` | `steady-basket` | strategy name (see table above) |
| `WARDEN_PAPER_TRADING` | `true` | fill approved intents at live prices instead of signing |
| `WARDEN_TICK_SECONDS` | `60` | worker tick interval |
| `WARDEN_SLIPPAGE_BPS` | `100` | max slippage vs the QuoterV2 simulation |
| `WARDEN_MIN_POOL_LIQUIDITY_USDG` | `25000` | pool-depth floor below which a token is refused a price |
| `WARDEN_MAX_PRICE_DIVERGENCE_BPS` | `500` | spot-vs-TWAP band above which a price is refused |
| `WARDEN_PERF_FEE_BPS` | `1000` | performance fee on profit above the high-water mark (accrual-only) |
| `WARDEN_BREAKER_ADDRESS` | — | deployed BreakerRegistry; a tripped breaker halts all intents |
| `WARDEN_LLM_PROVIDER` / `WARDEN_LLM_API_KEY` | — | AI provider id + key: Groq, OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Mistral, OpenRouter, Together, Perplexity, Cerebras, Fireworks, Ollama (local), or any OpenAI-compatible endpoint |
| `ANTHROPIC_API_KEY` | — | the Anthropic provider — and the only backend that also does screen vision |
| `WARDEN_TELEGRAM_BOT_TOKEN` | — | @BotFather token; enables the Telegram bridge (all other Telegram + PC-control settings live in `/settings`) |

PancakeSwap v3 is the only execution venue: its SwapRouter is the sole approved
spender the wall grants a session key. PancakeSwap v2 is read for **pair
discovery only** — never for pricing or trading.

`npm test` covers the policy mirror (including the no-exit rule and the scout
ceiling), the wall's exact shape, strategies, venue math (slippage, quote
selection, calldata), the ERC-8056 split invariant, and the Telegram +
PC-control safety layer (allowlist enforcement, path-traversal rejection,
capability gating, confirm-park, prompt-injection → no-op).

</details>

---

MIT licensed.
