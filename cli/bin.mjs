#!/usr/bin/env node
/**
 * warden CLI — the terminal front door.
 *
 * Install (no clone):   npm install -g warden        (or github:millw14/warden)
 * Then:                 warden onboard && warden start
 *
 *   warden onboard        interactive setup wizard (keys, strategy, basket)
 *   warden start          run web + worker together
 *   warden doctor         diagnose the whole stack
 *   warden status         what the agent is doing right now
 *   warden strategy new   scaffold a custom strategy in ~/.warden/strategies
 *   warden strategy list  builtins + your strategies
 *   warden selftest       one policy-legal no-op through the full pipeline
 *   warden kill           terminal kill switch (deletes the grant)
 *   warden wallets        every wallet on this machine (live + archived) + balances
 *   warden recover        sweep the smart account's funds to a wallet you control
 *
 * Zero dependencies. All user data lives in ~/.warden (override with
 * WARDEN_HOME) — the install location stays disposable.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { banner, c, spinner, type as typeOut, withSpinner } from "./ui.mjs";

// Where the PACKAGE lives (npm global dir or a checkout) — code, never data.
import { installService, serviceLogTail, serviceStatus, uninstallService } from "./service.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Where the USER's data lives — settings, grant, ledger, strategies.
const HOME = process.env.WARDEN_HOME ?? path.join(os.homedir(), ".warden");
const SETTINGS = path.join(HOME, "settings.json");
const GRANT = path.join(HOME, "grant.json");
const HEARTBEAT = path.join(HOME, "heartbeat.json");
const DB = path.join(HOME, "warden.db");
const STRATEGIES = path.join(HOME, "strategies");
// Every wallet this machine has armed — one file per smart account. grant.json is
// a single slot, so replacing or killing a wallet archives the old one here first
// (with its owner key) instead of stranding whatever's still funded in it.
const GRANTS_ARCHIVE = path.join(HOME, "grants");
const PKG_STRATEGIES = path.join(ROOT, "strategies");
const WELCOMED = path.join(HOME, ".welcomed");

const RPC_MAINNET = "https://bsc-dataseed.binance.org";
const RPC_TESTNET = "https://data-seed-prebsc-1-s1.binance.org:8545";
const BUILTINS = ["steady-basket", "weekend-gap", "llm-strategist", "even-keel", "dip-hunter"];
// tsx worker entry that rebuilds the Kernel account and sweeps it (warden recover).
const RECOVER_CLI = path.join(ROOT, "worker", "src", "recover-cli.ts");
const EXPLORER = {
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
};

const green = c.green;
const red = c.red;
const yellow = c.gold;
const dim = c.dim;
const bold = c.bold;
const ok = (s) => console.log(`  ${green("✓")} ${s}`);
const bad = (s) => console.log(`  ${red("✗")} ${s}`);
const warn = (s) => console.log(`  ${yellow("⚑")} ${s}`);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

/** Create ~/.warden, migrate any legacy <checkout>/.data, seed the example. */
function ensureHome() {
  mkdirSync(STRATEGIES, { recursive: true });
  const legacy = path.join(ROOT, ".data");
  if (existsSync(legacy)) {
    for (const name of ["settings.json", "grant.json", "warden.db", "heartbeat.json"]) {
      const from = path.join(legacy, name);
      const to = path.join(HOME, name);
      if (existsSync(from) && !existsSync(to)) {
        try {
          copyFileSync(from, to);
          console.log(dim(`  migrated legacy .data/${name} → ${to}`));
        } catch {
          /* best effort */
        }
      }
    }
  }
  // Seed the example strategy + doc so the folder explains itself.
  for (const name of ["example-dip-buyer.mjs", "README.md"]) {
    const from = path.join(PKG_STRATEGIES, name);
    const to = path.join(STRATEGIES, name);
    if (existsSync(from) && !existsSync(to)) {
      try {
        copyFileSync(from, to);
      } catch {
        /* best effort */
      }
    }
  }
}

/** Write a file that holds secrets with owner-only (0600) perms. Best-effort on non-POSIX. */
function writeSecret(file, data) {
  writeFileSync(file, data, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows / already tight */
  }
}

function writeSettings(next) {
  ensureHome();
  writeSecret(SETTINGS, JSON.stringify(next, null, 2)); // holds plaintext API keys
}

/** Symbols straight from the registry source — stays in sync with core. */
function knownSymbols() {
  try {
    const src = readFileSync(path.join(ROOT, "packages", "core", "src", "tokens.ts"), "utf8");
    return [...src.matchAll(/symbol: "([A-Z]+)"/g)].map((m) => m[1]);
  } catch {
    return ["AAPL", "MSFT", "QQQ"];
  }
}

async function listCustom() {
  try {
    const files = await readdir(STRATEGIES);
    return files
      .filter((f) => /\.(ts|mts|mjs|js)$/.test(f) && !f.startsWith("."))
      .map((f) => f.replace(/\.(ts|mts|mjs|js)$/, ""))
      .filter((n) => /^[A-Za-z0-9_-]{1,64}$/.test(n))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Spawn a local tool robustly across platforms. On Windows the .bin shims are
 * .cmd files, which Node 22 only runs via shell:true — and shell:true needs the
 * exe path AND any space-containing args quoted (the package or repo path may
 * contain spaces, e.g. "milla projects"). On POSIX we spawn directly, no shell.
 */
function toolSpawn(bin, args, opts, sync = false) {
  const runner = sync ? spawnSync : spawn;
  if (process.platform === "win32") {
    const q = (s) => (/[\s&()[\]{}^=;!'+,`~]/.test(s) ? `"${s}"` : s);
    const line = `${q(bin)} ${args.map(q).join(" ")}`;
    return runner(line, { ...opts, shell: true, windowsHide: true });
  }
  return runner(bin, args, { ...opts, shell: false });
}

/** Local binary from the package's own node_modules (works installed or cloned). */
function localBin(name) {
  const bin = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
  if (!existsSync(bin)) {
    bad(`${name} not found in ${dim(path.join(ROOT, "node_modules", ".bin"))} — is the install complete? (npm install)`);
    process.exit(1);
  }
  return bin;
}

function makePrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  const askSecret = (q) =>
    new Promise((res) => {
      const orig = rl._writeToOutput.bind(rl);
      process.stdout.write(q);
      rl._writeToOutput = (s) => {
        if (s.includes("\n") || s.includes("\r")) orig(s);
        else rl.output.write("*");
      };
      rl.question("", (answer) => {
        rl._writeToOutput = orig;
        res(answer);
      });
    });
  return { rl, ask, askSecret, close: () => rl.close() };
}

async function rpcCall(url, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const json = await res.json();
    return json.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────────────────────────────────────── wallets/archive ──

const USDG_ADDR = "0x55d398326f99059fF775485246999027B3197955"; // BSC USDT, 18 decimals (not Ethereum's 6)

/** Copy the live grant into the archive before anything destroys it. */
function archiveCurrentGrant() {
  try {
    const raw = readFileSync(GRANT, "utf8");
    const g = JSON.parse(raw.replace(/^﻿/, ""));
    if (!g?.smartAccount) return null;
    mkdirSync(GRANTS_ARCHIVE, { recursive: true, mode: 0o700 });
    // Archived grant holds a plaintext OWNER KEY — owner-only perms (0600).
    writeSecret(path.join(GRANTS_ARCHIVE, `${g.smartAccount.toLowerCase()}.json`), raw);
    return g.smartAccount;
  } catch {
    return null; // nothing to keep
  }
}

/** Archived wallets that still carry their owner key (i.e. recoverable). */
async function archivedWallets() {
  try {
    const files = await readdir(GRANTS_ARCHIVE);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(GRANTS_ARCHIVE, f)))
      .filter((g) => g && g.smartAccount);
  } catch {
    return [];
  }
}

const rpcFor = (s, chainId) =>
  chainId === 97 ? (s.rpcTestnet ?? RPC_TESTNET) : (s.rpcMainnet ?? RPC_MAINNET);

async function usdgBalance(rpc, addr) {
  const data = "0x70a08231" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const r = await rpcCall(rpc, "eth_call", [{ to: USDG_ADDR, data }, "latest"]);
  try {
    // BSC USDT is 18dp — Number(BigInt(r)) directly would overflow float
    // precision for realistic balances (same bug class as worker/src/index.ts's
    // usdg() helper). Divide down to 6dp in BigInt space first, which is exact,
    // then convert — 6dp-scaled USD amounts stay well within safe-integer range.
    return Number(BigInt(r) / 10n ** 12n) / 1e6;
  } catch {
    return null;
  }
}

async function ethBalance(rpc, addr) {
  const r = await rpcCall(rpc, "eth_getBalance", [addr, "latest"]);
  try {
    return Number(BigInt(r)) / 1e18;
  } catch {
    return null;
  }
}

/**
 * `warden wallets` — every wallet this machine knows about, live + archived,
 * with what each one actually holds. The answer to "where did my other wallet go?"
 */
async function wallets() {
  await banner("every wallet on this machine");
  ensureHome();
  const s = readJson(SETTINGS) ?? {};

  const seen = new Set();
  const list = [];
  const current = readJson(GRANT);
  if (current?.smartAccount) {
    list.push({ g: current, active: true });
    seen.add(current.smartAccount.toLowerCase());
  }
  for (const g of await archivedWallets()) {
    if (!seen.has(g.smartAccount.toLowerCase())) {
      list.push({ g, active: false });
      seen.add(g.smartAccount.toLowerCase());
    }
  }

  if (list.length === 0) {
    warn("no wallets on this machine yet.");
    console.log(`  create one at ${bold("http://localhost:3100/grant")}\n`);
    return;
  }

  console.log();
  for (const { g, active } of list) {
    const rpc = rpcFor(s, g.chainId);
    const [usdg, eth] = await Promise.all([usdgBalance(rpc, g.smartAccount), ethBalance(rpc, g.smartAccount)]);
    const key = g.demoOwnerPrivateKey ? green("🔑 owner key on disk") : red("⚠ no owner key — not recoverable here");
    console.log(`  ${active ? green("● active ") : dim("○ archived")}  ${bold(g.smartAccount)} ${dim(`· chain ${g.chainId}`)}`);
    console.log(
      `     ${bold(usdg === null ? "?" : `${usdg.toFixed(2)} USDG`)} · ${eth === null ? "?" : `${eth.toFixed(5)} ETH`}  ${key}`,
    );
  }
  console.log(
    `\n  ${c.gold(c.arrow)} ${dim("sweep funds out:")} ${bold("warden recover")}\n` +
      `  ${c.gold(c.arrow)} ${dim("put one back to work:")} ${bold("http://localhost:3100/grant")} ${dim("→ restore a funded wallet")}\n`,
  );
}

// ─────────────────────────────────────────────────────────────── welcome ──

/** Animated welcome — the delightful first thing after install. */
async function welcome() {
  await banner("your agent is ready");
  console.log(
    `  ${bold("set up.")} create your first agent:\n\n` +
      `     ${bold(c.lime("warden onboard"))}   ${dim("set it up — bundler, keys, strategy, basket")}\n` +
      `     ${bold(c.lime("warden start"))}     ${dim("open the dashboard (localhost:3100) + start the worker")}\n\n` +
      `  ${c.gold(c.arrow)} ${dim("your keys, your caps · bounded worst case · every trade simulated first")}\n` +
      `  ${c.gold(c.arrow)} ${dim("learn more:")} ${bold("https://TODO-your-domain.example")}\n`,
  );
}

/**
 * Show the welcome once, the first time any command runs after install.
 * Marker lives in ~/.warden so a reinstall (fresh home) re-greets.
 */
async function maybeFirstRun(cmd) {
  if (existsSync(WELCOMED)) return;
  try {
    ensureHome();
    writeFileSync(WELCOMED, new Date().toISOString(), "utf8");
  } catch {
    return; // can't write marker → skip rather than greet every run
  }
  // These already open with their own banner (onboard/start/welcome) or the
  // help banner (bare command) — a second one would just be noise. First-run
  // greeting is for the commands that otherwise start cold.
  if (cmd === undefined || ["welcome", "onboard", "start"].includes(cmd)) return;
  await welcome();
  console.log(dim("  ─────────────────────────────────────────────\n"));
}

// ─────────────────────────────────────────────────────────────── onboard ──

async function onboard() {
  await banner("set up your agent · trade the spread · keep the yield");
  console.log(
    `  ${dim("your keys, your caps · bounded worst case · every trade simulated first")}\n` +
      `  ${bold("Every step here is optional.")} Press Enter through them all and your agent\n` +
      `  starts in ${green("paper mode")} — real live prices, simulated fills, zero funds. Add a\n` +
      `  Pimlico key later (here or in the dashboard) whenever you want to trade for real.\n\n` +
      `  Everything you tell me is stashed in ${dim(HOME)} — yours, outside the install.\n` +
      `  Blank answers keep what's saved. Ctrl+C to back out anytime.\n`,
  );

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    bad(`Node ${process.versions.node} — warden needs Node 22+ (node:sqlite). Install from nodejs.org and rerun.`);
    process.exit(1);
  }
  if (!existsSync(path.join(ROOT, "node_modules"))) {
    bad("install incomplete — node_modules missing next to the package. Reinstall: npm install -g warden");
    process.exit(1);
  }

  ensureHome();
  const current = readJson(SETTINGS) ?? {};
  const p = makePrompter();
  const keep = (has) => dim(has ? ` [saved — blank keeps it]` : ` [blank skips]`);

  console.log(bold(`\n  ${c.arrow} 1/4 · go live`) + dim("  (optional — skip to stay in practice mode)"));
  console.log(dim("  To place real trades, warden needs one key: a free ") + "Pimlico" + dim(" key that relays"));
  console.log(dim("  your agent's transactions on-chain. Grab it at ") + bold("dashboard.pimlico.io") + dim(" → API Keys."));
  console.log(dim("  Paste just the key — we build the right URL for your chain automatically."));
  const bundlerKey = (await p.askSecret(`  Pimlico API key${keep(current.bundlerApiKey || current.bundlerUrl)}: `)).trim();
  if (bundlerKey) current.bundlerApiKey = bundlerKey;

  console.log(bold(`\n  ${c.arrow} 2/4 · give it a brain`) + dim("  (optional — free to test)"));
  // Mirrors packages/core/src/llm-providers.ts. Kept inline because this CLI is
  // plain ESM and can't import the TS core. keyField routes the key to the field
  // the worker reads: groq/anthropic keep their classic fields, the rest use llmApiKey.
  const LLM_PROVIDERS = [
    { id: "gateway", label: "Hosted gateway (unconfigured)", keyField: "llmApiKey", modelField: "llmProviderModel", def: "gateway-fast", key: "warden-gateway-production.up.railway.app/claim", needsKey: true },
    { id: "groq", label: "Groq", keyField: "groqApiKey", modelField: "groqModel", def: "llama-3.3-70b-versatile", key: "console.groq.com/keys", free: true, needsKey: true },
    { id: "openai", label: "OpenAI", keyField: "llmApiKey", modelField: "llmProviderModel", def: "gpt-4o-mini", key: "platform.openai.com/api-keys", needsKey: true },
    { id: "anthropic", label: "Anthropic (Claude)", keyField: "anthropicApiKey", modelField: "llmModel", def: "claude-opus-4-8", key: "console.anthropic.com/settings/keys", needsKey: true },
    { id: "google", label: "Google Gemini", keyField: "llmApiKey", modelField: "llmProviderModel", def: "gemini-2.0-flash", key: "aistudio.google.com/apikey", free: true, needsKey: true },
    { id: "xai", label: "xAI (Grok)", keyField: "llmApiKey", modelField: "llmProviderModel", def: "grok-2-latest", key: "console.x.ai", needsKey: true },
    { id: "deepseek", label: "DeepSeek", keyField: "llmApiKey", modelField: "llmProviderModel", def: "deepseek-chat", key: "platform.deepseek.com/api_keys", needsKey: true },
    { id: "mistral", label: "Mistral", keyField: "llmApiKey", modelField: "llmProviderModel", def: "mistral-large-latest", key: "console.mistral.ai/api-keys", needsKey: true },
    { id: "openrouter", label: "OpenRouter", keyField: "llmApiKey", modelField: "llmProviderModel", def: "meta-llama/llama-3.3-70b-instruct", key: "openrouter.ai/keys", needsKey: true },
    { id: "together", label: "Together AI", keyField: "llmApiKey", modelField: "llmProviderModel", def: "meta-llama/Llama-3.3-70B-Instruct-Turbo", key: "api.together.ai/settings/api-keys", needsKey: true },
    { id: "perplexity", label: "Perplexity", keyField: "llmApiKey", modelField: "llmProviderModel", def: "sonar", key: "perplexity.ai/settings/api", needsKey: true },
    { id: "cerebras", label: "Cerebras", keyField: "llmApiKey", modelField: "llmProviderModel", def: "llama-3.3-70b", key: "cloud.cerebras.ai", free: true, needsKey: true },
    { id: "fireworks", label: "Fireworks", keyField: "llmApiKey", modelField: "llmProviderModel", def: "accounts/fireworks/models/llama-v3p3-70b-instruct", key: "fireworks.ai/account/api-keys", needsKey: true },
    { id: "ollama", label: "Ollama (local)", keyField: "llmApiKey", modelField: "llmProviderModel", def: "llama3.1", key: "ollama.com/download", needsKey: false },
    { id: "custom", label: "Custom (OpenAI-compatible)", keyField: "llmApiKey", modelField: "llmProviderModel", def: "", key: "", needsKey: true, custom: true },
  ];
  console.log(dim("  Pick who powers plain-English chat + the AI strategist. Free: Groq, Google, Cerebras. Local (no key): Ollama."));
  LLM_PROVIDERS.forEach((prov, i) =>
    console.log(
      `  ${i + 1}. ${prov.label}${prov.free ? green(" free") : ""}${prov.needsKey === false ? dim(" · local") : ""}${prov.id === (current.llmProvider ?? "groq") ? green(" ← current") : ""}`,
    ),
  );
  const brainPick = (await p.ask(`  pick 1-${LLM_PROVIDERS.length} [blank keeps current]: `)).trim();
  const brainIdx = Number(brainPick) - 1;
  const chosen =
    brainPick && Number.isInteger(brainIdx) && LLM_PROVIDERS[brainIdx]
      ? LLM_PROVIDERS[brainIdx]
      : (LLM_PROVIDERS.find((x) => x.id === (current.llmProvider ?? "groq")) ?? LLM_PROVIDERS[0]);
  current.llmProvider = chosen.id;
  if (chosen.custom) {
    const base = (await p.ask(`  base URL (OpenAI-compatible /v1)${keep(current.llmBaseUrl)}: `)).trim();
    if (base) current.llmBaseUrl = base;
  }
  if (chosen.needsKey === false) {
    console.log(dim(`  ${chosen.label} runs on your machine — no key needed. Install/run it: `) + bold(chosen.key));
  } else {
    if (chosen.key) console.log(dim("  Grab a key at ") + bold(chosen.key) + dim("."));
    const brainKey = (await p.askSecret(`  ${chosen.label} API key${keep(current[chosen.keyField])}: `)).trim();
    if (brainKey) current[chosen.keyField] = brainKey;
  }
  const modelPrompt = current[chosen.modelField] || chosen.def || "provider default";
  const brainModel = (await p.ask(`  model [${modelPrompt}]: `)).trim();
  if (brainModel) current[chosen.modelField] = brainModel;

  console.log(bold(`\n  ${c.arrow} 3/4 · pick a strategy`));
  const custom = await listCustom();
  const all = [...BUILTINS, ...custom];
  all.forEach((s, i) =>
    console.log(
      `  ${i + 1}. ${s}${custom.includes(s) ? dim(" (yours)") : ""}${s === (current.strategy ?? "steady-basket") ? green(" ← current") : ""}`,
    ),
  );
  console.log(dim(`  write your own: warden strategy new <name>  (template lands in ${STRATEGIES})`));
  const pick = (await p.ask(`  pick 1-${all.length} [blank keeps current]: `)).trim();
  const idx = Number(pick) - 1;
  if (pick && Number.isInteger(idx) && all[idx]) current.strategy = all[idx];

  console.log(bold(`\n  ${c.arrow} 4/4 · the loot`) + dim("  (basket — equal-weighted)"));
  const symbols = knownSymbols();
  console.log(dim(`  available: ${symbols.join(" ")}`));
  const basketNow = (current.basketSymbols ?? ["QQQ", "NVDA", "TSLA"]).join(",");
  const basket = (await p.ask(`  symbols, comma-separated [${basketNow}]: `)).trim();
  if (basket) {
    const chosen = basket.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const unknown = chosen.filter((s) => !symbols.includes(s));
    if (unknown.length) warn(`ignoring unknown symbols: ${unknown.join(", ")}`);
    const valid = chosen.filter((s) => symbols.includes(s));
    if (valid.length) current.basketSymbols = valid;
  }

  console.log(bold(`\n  ${c.arrow} connect Telegram`) + dim("  (chat with your agent — optional)"));
  console.log(dim("  Create a bot: message @BotFather in Telegram, send /newbot, copy the token."));
  console.log(dim("  Then finish linking from the dashboard settings, or leave blank to skip."));
  const tgToken = (await p.askSecret(`  Telegram bot token${keep(current.telegramBotToken)}: `)).trim();
  if (tgToken) {
    current.telegramBotToken = tgToken;
    current.telegramEnabled = true;
    ok("telegram enabled — you'll link your chat from the dashboard");
  }

  p.close();
  const s = spinner("stashing your plans in the hollow oak");
  writeSettings(current);
  await new Promise((r) => setTimeout(r, 400));
  s.succeed(`stashed ${dim(SETTINGS)}`);

  console.log(`
${bold(`  ${c.arrow} next steps`)}
  1. ${bold("warden start")} — opens the dashboard at http://localhost:3100 + starts the worker
  2. at ${bold("/grant")}, create your agent wallet — pick testnet 97 (practice) or mainnet 56 (real funds)
  3. testnet ${bold("gas")} from the official faucet: ${dim("https://www.bnbchain.org/en/testnet-faucet")}
     ${dim("gas only — USDG sent to a testnet account is never shown and never traded.")}
     ${dim("mainnet: send BNB (gas) + USDG (capital) from your own wallet.")}
  4. run a dry check: ${bold("warden selftest")}
  5. check anytime: ${bold("warden doctor")} · tune it: ${dim("http://localhost:3100/settings")}

  ${dim("guide & docs:")} ${bold("https://TODO-your-domain.example")} ${dim("·")} ${dim("https://TODO-your-domain.example/docs")}
`);
}

/** Open a URL in the default browser, cross-platform. Best-effort, never throws. */
function openBrowser(url) {
  try {
    const [cmd, args] =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    spawn(cmd, args, { stdio: "ignore", detached: true, shell: false }).unref();
  } catch {
    // no browser to open (headless/server) — the URL is printed anyway
  }
}

// ───────────────────────────────────────────────────────────────── start ──

async function start() {
  ensureHome();
  warnIfOldNode();
  const noOpen = process.argv.includes("--no-open");
  // Bind localhost-only by default: the dashboard has no login and holds your
  // trading controls, so it must not be reachable from the LAN. Opt into
  // network access explicitly with WARDEN_HOST=0.0.0.0 (e.g. phone on your
  // home WiFi) — only on a network you trust.
  const host = process.env.WARDEN_HOST || "127.0.0.1";
  const url = "http://localhost:3100";
  await banner("starting up");
  const web = path.join(ROOT, "web");
  // Serve the prebuilt production app (next start), not dev-mode — the robust
  // distribution model. If the build is missing (a source install where the
  // prepare hook didn't run), build it once under a spinner.
  if (!existsSync(path.join(web, ".next", "BUILD_ID"))) {
    try {
      await withSpinner("raising the dashboard (first-run build, ~15s)", async () => {
        const b = toolSpawn(localBin("next"), ["build"], { cwd: web }, true);
        if (b.status !== 0) throw new Error("build failed");
      });
    } catch {
      bad("the dashboard won't stand (dashboard build failed) — the worker still runs via `warden selftest`.");
      process.exit(1);
    }
  }

  let opened = false;
  const openOnce = () => {
    if (opened || noOpen) return;
    opened = true;
    console.log(`\n  ${c.green(c.arrow)} dashboard's open — ${c.bold(url)} ${dim("(opening your browser…)")}\n`);
    openBrowser(url);
  };

  // Next serves from the app dir as cwd; the worker runs from ROOT.
  // The WORKER is supervised: a crash (a bad tick, an RPC blip) auto-restarts
  // with backoff instead of leaving a silently-dead worker. The dashboard is not
  // — a broken build should fail visibly, not crash-loop.
  let shuttingDown = false;
  const children = new Set();
  let workerRestarts = 0;

  const specs = [
    { name: "dashboard", bin: localBin("next"), args: ["start", "-p", "3100", "-H", host], cwd: web, supervise: false },
    { name: "worker", bin: localBin("tsx"), args: [path.join(ROOT, "worker", "src", "index.ts")], cwd: ROOT, supervise: true },
  ];

  function launch(spec) {
    const startedAt = Date.now();
    const child = toolSpawn(spec.bin, spec.args, { cwd: spec.cwd });
    children.add(child);
    const pipe = (stream, sink) =>
      stream.on("data", (chunk) => {
        const text = String(chunk);
        if (spec.name === "dashboard" && /Ready|started server|Local:/i.test(text)) openOnce();
        text
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .forEach((l) => sink.write(`${dim(`[${spec.name}]`)} ${l}\n`));
      });
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on("exit", (code) => {
      children.delete(child);
      console.log(`${dim(`[${spec.name}]`)} exited (${code})`);
      if (shuttingDown || !spec.supervise) return;
      // A long-lived run that then dies is a fresh incident, not a crash loop.
      if (Date.now() - startedAt > 60_000) workerRestarts = 0;
      workerRestarts += 1;
      if (workerRestarts > 8) {
        bad("the worker keeps crashing right after starting — fix the error above, then `warden start`.");
        return;
      }
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(workerRestarts, 5));
      warn(`worker stopped — restarting in ${Math.round(delay / 1000)}s (restart #${workerRestarts})`);
      setTimeout(() => {
        if (!shuttingDown) launch(spec);
      }, delay);
    });
  }

  specs.forEach(launch);
  // Fallback: open even if we never matched a ready line.
  setTimeout(openOnce, 12_000);

  console.log(dim("  Ctrl+C stops both.\n"));
  const stop = () => {
    shuttingDown = true;
    console.log(`\n  ${c.gold(c.arrow)} stopping…`);
    children.forEach((ch) => ch.kill("SIGINT"));
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

/** Print the installed version — so you can tell what build is running. */
function version() {
  try {
    const pkg = readJson(path.join(ROOT, "package.json"));
    console.log(`warden v${pkg?.version ?? "unknown"}`);
  } catch {
    console.log("warden (version unknown)");
  }
}

// ──────────────────────────────────────────────────────────────── doctor ──

async function doctor() {
  console.log(`\n${bold(`  ${c.arrow} rig check`)}  ${dim("is everything set up correctly?")}\n`);
  ensureHome();
  const s = readJson(SETTINGS) ?? {};

  nodeVersionOk()
    ? ok(`node ${process.versions.node}`)
    : bad(`node ${process.versions.node} — need ${NODE_MIN.join(".")}+ for node:sqlite (run: warden setup)`);
  const npmV = sh("npm", ["--version"]);
  npmV ? ok(`npm ${npmV}`) : warn("npm not found on PATH — reinstall Node (run: warden setup)");
  const binDir = npmGlobalBinDir();
  if (binDir && !onPath(binDir)) warn(`npm global bin not on PATH — "command not found" trap (run: warden setup)`);
  existsSync(path.join(ROOT, "node_modules")) ? ok("package install complete") : bad("node_modules missing — reinstall");
  console.log(`  ${dim(`package: ${ROOT}`)}`);
  console.log(`  ${dim(`home:    ${HOME}`)}`);

  existsSync(SETTINGS) ? ok("settings present") : warn("no settings yet — run: warden onboard");
  const paperOn = s.paperTradingEnabled !== false;
  const hasSigner = !!(s.bundlerApiKey || s.bundlerUrl || process.env.WARDEN_BUNDLER_API_KEY || process.env.WARDEN_BUNDLER_URL);
  hasSigner
    ? ok("bundler key configured — can sign live trades")
    : paperOn
      ? ok("no bundler key — running in 📜 paper mode (simulated fills at live prices)")
      : warn("no bundler key and paper trading off — the agent won't trade (get a key: dashboard.pimlico.io)");
  // The four things that silently mute the bot / idle the brain:
  const hasLlm = !!(
    s.groqApiKey ||
    s.anthropicApiKey ||
    s.llmApiKey ||
    s.llmProvider === "ollama" ||
    process.env.GROQ_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.WARDEN_LLM_API_KEY
  );
  const brainName = s.llmProvider
    ? s.llmProvider
    : s.anthropicApiKey || process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : "groq";
  hasLlm
    ? ok(`AI brain set (${brainName})`)
    : warn("no AI provider key — plain-English chat + llm-strategist idle. Pick one in /settings (free: Groq, Google, Cerebras; local: Ollama).");
  if (s.telegramBotToken || process.env.WARDEN_TELEGRAM_BOT_TOKEN) {
    s.telegramEnabled === false
      ? warn("Telegram token set but DISABLED — enable it in /settings so the bot answers")
      : Array.isArray(s.telegramAllowlist) && s.telegramAllowlist.length
        ? ok(`Telegram on and linked (${s.telegramAllowlist.length} chat${s.telegramAllowlist.length > 1 ? "s" : ""})`)
        : warn("Telegram on but nobody linked — send /link <code> from the dashboard to claim it");
  } else {
    warn("no Telegram token — chat/control off (optional; add one in /settings)");
  }
  if (process.platform === "win32") {
    const pol = sh("powershell", ["-NoProfile", "-Command", "Get-ExecutionPolicy"]);
    pol && /Restricted|AllSigned/i.test(pol)
      ? bad(`PowerShell policy is ${pol.trim()} — 'warden' scripts are blocked. Fix: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`)
      : ok(`PowerShell script policy ok (${(pol || "unknown").trim()})`);
  }

  const sp1 = spinner("checking BSC (mainnet)");
  const mainnetBlock = await rpcCall(s.rpcMainnet ?? RPC_MAINNET, "eth_blockNumber");
  mainnetBlock
    ? sp1.succeed(`mainnet RPC reachable ${dim(`block ${parseInt(mainnetBlock, 16).toLocaleString()}`)}`)
    : sp1.fail("mainnet RPC unreachable");
  const sp2 = spinner("checking BSC testnet");
  const testnetBlock = await rpcCall(s.rpcTestnet ?? RPC_TESTNET, "eth_blockNumber");
  testnetBlock
    ? sp2.succeed(`testnet RPC reachable ${dim(`block ${parseInt(testnetBlock, 16).toLocaleString()}`)}`)
    : sp2.fail("testnet RPC unreachable");

  if (s.bundlerUrl) {
    const sp3 = spinner("waking the getaway horse (bundler)");
    const eps = await rpcCall(s.bundlerUrl, "eth_supportedEntryPoints");
    Array.isArray(eps) && eps.length
      ? sp3.succeed(`bundler reachable ${dim(`${eps.length} entrypoint${eps.length > 1 ? "s" : ""}`)}`)
      : sp3.fail("bundler did not answer eth_supportedEntryPoints — check the URL/key");
  }

  const grant = readJson(GRANT);
  if (!grant) {
    warn("no grant — sign one at http://localhost:3100/grant");
  } else {
    const left = grant.expiresAt - Math.floor(Date.now() / 1000);
    left > 0
      ? ok(`grant armed for ${grant.smartAccount.slice(0, 10)}… (chain ${grant.chainId}, expires in ${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h)`)
      : bad("grant EXPIRED — sign a new one at /grant");
  }

  const hb = readJson(HEARTBEAT);
  if (hb && Math.floor(Date.now() / 1000) - hb.at < 90)
    ok(`worker alive (heartbeat ${Math.floor(Date.now() / 1000) - hb.at}s ago, block ${hb.block}${hb.mode ? `, mode ${hb.mode}` : ""})`);
  else warn("worker not running (no heartbeat in 90s) — warden start");

  existsSync(DB) ? ok("ledger present (~/.warden/warden.db)") : warn("no ledger yet — appears after the worker's first tick");

  const custom = await listCustom();
  const strategy = s.strategy ?? "steady-basket";
  if (BUILTINS.includes(strategy)) ok(`strategy: ${strategy} (builtin)`);
  else if (custom.includes(strategy)) ok(`strategy: ${strategy} (yours, ~/.warden/strategies/${strategy}.*)`);
  else bad(`strategy "${strategy}" is neither builtin nor in ${STRATEGIES} — the worker will idle with a warning`);
  if (custom.length) console.log(`  ${dim(`your strategies: ${custom.join(", ")}`)}`);

  // telegram
  if (s.telegramBotToken && s.telegramEnabled) {
    const tg = await rpcTelegramGetMe(s.telegramBotToken);
    tg ? ok(`telegram: connected as @${tg}`) : bad("telegram: token set but getMe failed — check the token");
  } else if (s.telegramBotToken) {
    warn("telegram: token set but disabled — enable it in the dashboard");
  } else {
    console.log(`  ${dim("telegram: not configured (optional — set it up in the dashboard)")}`);
  }

  // auto-start. Installed and running are different facts, and reporting only
  // the first is how an owner believes their agent survived a reboot when it
  // didn't. Purely informational — doctor never changes anything.
  const svc = serviceStatus();
  if (!svc.installed) {
    console.log(`  ${dim("auto-start: not installed — `warden service install` to start on login")}`);
  } else if (svc.running) {
    ok(`auto-start: installed and running (${svc.where})`);
  } else {
    warn(`auto-start: installed but not running right now — starts at your next login`);
  }
  console.log();
}

/** getMe against the Bot API for `doctor`; returns @username or null. */
async function rpcTelegramGetMe(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
    const j = await res.json();
    return j && j.ok && j.result && j.result.username ? j.result.username : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────── status ──

async function status() {
  console.log(`\n${bold(`  ${c.arrow} status`)}\n`);
  const hb = readJson(HEARTBEAT);
  const now = Math.floor(Date.now() / 1000);
  if (hb && now - hb.at < 90) ok(`worker alive — heartbeat ${now - hb.at}s ago at block ${hb.block}`);
  else warn("worker not running");

  const grant = readJson(GRANT);
  if (grant) {
    const left = grant.expiresAt - now;
    console.log(`  agent ${grant.smartAccount} ${dim(`chain ${grant.chainId}`)}`);
    console.log(`  caps: ${grant.caps.perTradeUsdg}/trade · ${grant.caps.dailyUsdg}/day · ${grant.caps.maxOpsPerDay} ops · breaker ${grant.caps.maxDrawdownPct}% · ${left > 0 ? `expires in ${Math.floor(left / 86400)}d` : red("EXPIRED")}`);
  } else {
    warn("no grant signed");
  }

  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(DB, { readOnly: true });
    const t = db.prepare("SELECT COUNT(*) AS n, SUM(status='landed') AS landed FROM trades").get();
    const eq = db.prepare("SELECT equity_usdg, datetime(at,'unixepoch') AS at FROM equity ORDER BY at DESC, id DESC LIMIT 1").get();
    const events = db.prepare("SELECT level, message, datetime(created_at,'unixepoch') AS at FROM events ORDER BY created_at DESC, id DESC LIMIT 3").all();
    console.log(`  trades: ${t?.landed ?? 0} landed / ${t?.n ?? 0} attempts`);
    if (eq) console.log(`  equity: ${Number(eq.equity_usdg).toFixed(2)} USDG ${dim(`(${eq.at} UTC)`)}`);
    if (events.length) {
      console.log(dim("  recent:"));
      for (const e of events) console.log(`    ${dim(e.at)} [${e.level}] ${e.message.slice(0, 100)}`);
    }
    db.close();
  } catch {
    console.log(dim("  no ledger yet"));
  }
  console.log();
}

// ────────────────────────────────────────────────────────────── strategy ──

const TEMPLATE = (name) => `/**
 * ${name} — your strategy. Hot-reloads on save; crash-isolated; every intent
 * you return is validated, policy-capped, quote-simulated, and finally
 * enforced by the on-chain session key the user signed. You propose; the
 * wall disposes. See README.md and example-dip-buyer.mjs in this folder.
 *
 * No imports needed — ctx injects the registry:
 *   ctx.tokenBySymbol.QQQ · ctx.CASH.USDG · ctx.UNISWAP.swapRouter02
 *   ctx.MORPHO.steakhouseUsdgVault · ctx.STOCK_TOKENS · ctx.usdg(25)
 * Units: USDG = 6dp bigint · stock balances = 18dp bigint · prices = 8dp bigint.
 */

export default {
  name: "${name}",

  tick(snap, ctx) {
    if (!snap.sequencerUp) return [];

    // your logic here — e.g. buy 10 USDG of QQQ when you like the setup:
    // return [{
    //   kind: "swap",
    //   target: ctx.UNISWAP.swapRouter02,
    //   sellToken: ctx.CASH.USDG,
    //   buyToken: ctx.tokenBySymbol.QQQ,
    //   sellAmountRaw: ctx.usdg(10),
    //   notionalUsdg: ctx.usdg(10),
    // }];

    return [];
  },
};
`;

async function strategyCmd(sub, name) {
  ensureHome();
  if (sub === "list") {
    console.log(bold("builtin"));
    BUILTINS.forEach((s) => console.log(`  ${s}`));
    const custom = await listCustom();
    console.log(bold("yours") + dim(` (${STRATEGIES})`));
    custom.length ? custom.forEach((s) => console.log(`  ${s}`)) : console.log(dim("  none yet — warden strategy new <name>"));
    return;
  }
  if (sub === "new") {
    if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
      bad("usage: warden strategy new <name>   (letters, digits, - and _ only)");
      process.exit(1);
    }
    if (BUILTINS.includes(name)) {
      bad(`"${name}" is a builtin — pick another name`);
      process.exit(1);
    }
    const file = path.join(STRATEGIES, `${name}.mjs`);
    if (existsSync(file)) {
      bad(`${file} already exists — refusing to overwrite`);
      process.exit(1);
    }
    writeFileSync(file, TEMPLATE(name), "utf8");
    ok(`created ${file}`);
    console.log(`  edit it, then select "${name}" in /settings or: warden onboard`);
    return;
  }
  bad("usage: warden strategy <list|new> [name]");
  process.exit(1);
}

// ────────────────────────────────────────────────────────── selftest/kill ──

function selftest() {
  console.log(`\n  ${bold(`${c.arrow} one arrow through the whole pipeline`)} ${dim("grant → policy → bundler → chain")}\n`);
  const child = toolSpawn(localBin("tsx"), [path.join(ROOT, "worker", "src", "index.ts"), "--selftest"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}

async function kill() {
  if (!existsSync(GRANT)) {
    warn("no grant to kill — nothing is armed");
    return;
  }
  const p = makePrompter();
  const answer = (await p.ask(`  ${red("KILL THE AGENT")} — destroy the grant? The worker halts on its next tick. [y/N]: `)).trim().toLowerCase();
  p.close();
  if (answer === "y" || answer === "yes") {
    // Keep the wallet + its owner key before the grant goes — killing the session
    // key must never mean losing access to funds still sitting in the account.
    const archived = archiveCurrentGrant();
    rmSync(GRANT, { force: true });
    ok("grant destroyed — the worker stands down on the next tick (on-chain expiry is the backstop)");
    if (archived) {
      console.log(
        `  ${dim("wallet archived — funds stay reachable:")} ${bold("warden wallets")} ${dim("·")} ${bold("warden recover")}`,
      );
    }
  } else {
    console.log(dim("  stayed the hand — nothing touched"));
  }
}

// ───────────────────────────────────────────────────────────────── recover ──

/**
 * Spawn recover-cli.ts (needs viem/@zerodev, which this CLI doesn't carry) and
 * relay it. The owner key rides in an env var — never on the command line, never
 * logged — so it can't leak into `ps` or shell history. Human progress streams
 * from the child's stderr; the one machine result line comes back on stdout.
 */
function runRecoverChild(mode, { ownerKey, to, chainId, expect }) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      WARDEN_RECOVER_OWNER_KEY: ownerKey,
      WARDEN_RECOVER_EXPECT: expect || "",
    };
    const child = toolSpawn(localBin("tsx"), [RECOVER_CLI, mode, to, String(chainId)], { cwd: ROOT, env });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => process.stderr.write(d)); // live progress
    child.on("exit", (code) => {
      let result = null;
      const line = out.split(/\r?\n/).find((l) => l.startsWith("__RESULT__"));
      if (line) {
        try {
          result = JSON.parse(line.slice("__RESULT__".length));
        } catch {
          /* leave result null — caller treats as failure */
        }
      }
      resolve({ code: code ?? 1, result });
    });
  });
}

/**
 * `warden recover` — sweep a smart account back to a wallet you control.
 *
 * The funded address is an ERC-4337 smart account, not a plain wallet: its owner
 * key derives a DIFFERENT address (what MetaMask shows — empty), so funds can't
 * be reached by importing the key. This rebuilds the account from the owner key
 * and moves everything out in one op. Works even after a kill switch, because it
 * signs with the owner (sudo) key, not the destroyed session key.
 */
async function recover() {
  await banner("recover your funds");
  ensureHome();
  warnIfOldNode();
  console.log(
    `  ${dim("The address you funded is a smart account, not a MetaMask wallet — its owner key")}\n` +
      `  ${dim("shows a different, empty address if you import it. This sweeps the real balance out.")}\n`,
  );

  const grant = readJson(GRANT);
  const p = makePrompter();

  let ownerKey;
  let chainId;
  let expect;

  // Every wallet on this machine whose owner key we hold: the active grant PLUS
  // every archived one (replaced/killed wallets are kept with their key). A picker
  // across ALL of them lets you recover a wallet that isn't the currently-armed
  // one — e.g. an old funded wallet you switched away from.
  const candidates = [];
  if (grant && /^0x[0-9a-fA-F]{64}$/.test(grant.demoOwnerPrivateKey ?? "")) {
    candidates.push({ key: grant.demoOwnerPrivateKey, account: grant.smartAccount, chainId: grant.chainId || 56, active: true });
  }
  for (const g of await archivedWallets()) {
    if (
      /^0x[0-9a-fA-F]{64}$/.test(g.demoOwnerPrivateKey ?? "") &&
      !candidates.some((c) => c.account?.toLowerCase() === g.smartAccount.toLowerCase())
    ) {
      candidates.push({ key: g.demoOwnerPrivateKey, account: g.smartAccount, chainId: g.chainId || 56, active: false });
    }
  }

  if (candidates.length === 1) {
    ({ key: ownerKey, account: expect, chainId } = candidates[0]);
    ok(`recovering ${expect.slice(0, 10)}… on chain ${chainId} ${dim("(owner key read from disk)")}`);
  } else if (candidates.length > 1) {
    console.log(`  ${green("✓")} ${candidates.length} wallets on this machine ${dim("(owner key on disk)")}:`);
    candidates.forEach((c, i) =>
      console.log(`    ${i + 1}. ${bold(c.account)} ${dim(`· chain ${c.chainId} · ${c.active ? "active" : "archived"}`)}`),
    );
    const pick = (await p.ask(`  which to recover? 1-${candidates.length}, or Enter to paste a different key: `)).trim();
    const idx = Number(pick) - 1;
    if (pick && Number.isInteger(idx) && candidates[idx]) {
      ({ key: ownerKey, account: expect, chainId } = candidates[idx]);
      ok(`using ${expect.slice(0, 10)}… ${dim("(owner key read from disk — never typed)")}`);
    }
  }

  if (!ownerKey) {
    warn(candidates.length ? "paste a different owner key to recover another wallet." : "no stored wallet — paste the owner key you backed up.");
    console.log(dim("  (input hidden)"));
    ownerKey = (await p.askSecret("  owner private key (0x…): ")).trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(ownerKey)) {
      p.close();
      bad("that isn't a 32-byte hex private key (expected 0x + 64 hex chars).");
      return;
    }
    const chainAns = (await p.ask("  chain — [1] mainnet 56 (real funds)  ·  [2] testnet 97  [1]: ")).trim();
    chainId = chainAns === "2" ? 97 : 56;
    expect = "";
  }

  const s = readJson(SETTINGS) ?? {};
  const hasBundler = !!(
    s.bundlerApiKey ||
    s.bundlerUrl ||
    process.env.WARDEN_BUNDLER_API_KEY ||
    process.env.WARDEN_BUNDLER_URL
  );
  if (!hasBundler) {
    p.close();
    bad("recovery needs a bundler key — a smart account can only move funds by sending a UserOp.");
    console.log(
      `  Add a free Pimlico key at ${bold("dashboard.pimlico.io")}, paste it into ${bold("warden onboard")}\n` +
        `  (or the dashboard ${dim("/settings")}), then rerun ${bold("warden recover")}.`,
    );
    return;
  }

  const to = (await p.ask("  send the funds to which address? (one YOU control — e.g. your MetaMask): ")).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
    p.close();
    bad("that isn't a valid address (expected 0x + 40 hex chars).");
    return;
  }

  console.log(dim("\n  reading what the account holds…\n"));
  const plan = await runRecoverChild("plan", { ownerKey, to, chainId, expect });
  if (!plan.result || plan.result.ok !== true) {
    p.close();
    bad(`couldn't read the account${plan.result?.error ? ` — ${plan.result.error}` : ""}.`);
    return;
  }
  const balances = plan.result.balances ?? [];
  if (balances.length === 0) {
    p.close();
    warn(`nothing to recover — ${plan.result.smartAccount} holds no USDG or tokens.`);
    console.log(dim("  If you expected funds here, check you're using the right owner key and chain."));
    return;
  }

  const list = balances.map((b) => `${b.amount} ${b.symbol}`).join(", ");
  console.log();
  warn(`about to sweep ${bold(list)}`);
  console.log(`  from ${dim(plan.result.smartAccount)}`);
  console.log(`  to   ${bold(to)}`);
  console.log(dim("  real and irreversible. the account keeps its dust ETH — it pays this op's gas.\n"));
  const confirm = (await p.ask(`  type ${bold("sweep")} to confirm: `)).trim().toLowerCase();
  p.close();
  if (confirm !== "sweep") {
    console.log(dim("  stayed the hand — nothing moved."));
    return;
  }

  console.log(dim("\n  signing the recovery op with your owner key…\n"));
  const done = await runRecoverChild("sweep", { ownerKey, to, chainId, expect });
  if (done.result?.ok && done.result.txHash) {
    const base = EXPLORER[chainId] ?? EXPLORER[56];
    console.log(`\n  ${green("✓")} ${bold("recovered.")} ${list} → ${to}`);
    console.log(`  proof: ${bold(`${base}/tx/${done.result.txHash}`)}\n`);
  } else {
    bad(
      `recovery didn't complete${done.result?.error ? ` — ${done.result.error}` : ""}. ` +
        "Your funds are still safe in the account; fix the cause above and rerun warden recover.",
    );
  }
}

// ──────────────────────────────────────────────────────── environment setup ──

const NODE_MIN = [22, 12]; // node:sqlite + the modern APIs the worker leans on

function nodeVersionOk(v = process.versions.node) {
  const [maj, min] = v.split(".").map(Number);
  return maj > NODE_MIN[0] || (maj === NODE_MIN[0] && min >= NODE_MIN[1]);
}

/** Run a command, capture trimmed stdout, never throw. null on any failure. */
function sh(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" });
    if (r.status === 0 && typeof r.stdout === "string") return r.stdout.trim();
  } catch {
    /* ignore */
  }
  return null;
}

/** The dir npm drops global CLIs into — what must be on PATH for `warden`. */
function npmGlobalBinDir() {
  const prefix = sh("npm", ["prefix", "-g"]);
  if (!prefix) return null;
  // Windows: the prefix dir itself holds the shims; POSIX: <prefix>/bin.
  return process.platform === "win32" ? prefix : path.join(prefix, "bin");
}

function onPath(dir) {
  if (!dir) return false;
  const norm = (p) =>
    process.platform === "win32" ? p.toLowerCase().replace(/[\\/]+$/, "") : p.replace(/\/+$/, "");
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map(norm)
    .includes(norm(dir));
}

/** The exact copy-paste line to put a dir on PATH for this OS. */
function pathFix(dir) {
  if (process.platform === "win32") {
    return `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";${dir}", "User")`;
  }
  return `echo 'export PATH="${dir}:$PATH"' >> ~/.zshrc && source ~/.zshrc`;
}

/** How to install a modern Node on this OS. */
function nodeInstallHint() {
  if (process.platform === "win32") return "winget install OpenJS.NodeJS.LTS   (or https://nodejs.org)";
  if (process.platform === "darwin") return "brew install node   (or https://nodejs.org)";
  return "use nvm/fnm, or https://nodejs.org/en/download";
}

/**
 * `warden setup` — a rig check that runs even when things are broken:
 * Node version, npm, and the global-bin PATH trap that yields
 * "warden: command not found". Prints exact, copy-paste fixes.
 */
async function setup() {
  await banner("kit up — check your rig");
  console.log();

  const v = process.versions.node;
  if (nodeVersionOk(v)) {
    ok(`node ${v} ${dim(`(need ${NODE_MIN.join(".")}+)`)}`);
  } else {
    bad(`node ${v} is too old — warden needs ${NODE_MIN.join(".")}+ (node:sqlite)`);
    console.log(`      ${bold("install a newer Node:")} ${dim(nodeInstallHint())}`);
  }

  const npmV = sh("npm", ["--version"]);
  npmV
    ? ok(`npm ${npmV}`)
    : bad("npm not found — it ships with Node; (re)install Node from https://nodejs.org");

  const binDir = npmGlobalBinDir();
  if (!binDir) {
    warn("couldn't locate npm's global bin (npm prefix -g failed) — is npm on PATH?");
  } else if (onPath(binDir)) {
    ok(`global CLIs on PATH ${dim(binDir)}`);
  } else {
    bad('npm\'s global bin isn\'t on PATH — the "warden: command not found" trap');
    console.log(`      ${dim(binDir)}`);
    console.log(`      ${bold("fix once")} ${dim("(then open a NEW terminal):")}`);
    console.log(`      ${dim(pathFix(binDir))}`);
    console.log(`      ${dim("…or just prefix commands: ")}${bold("npx warden start")}`);
  }

  const resolved =
    process.platform === "win32" ? sh("where", ["warden"]) : sh("which", ["warden"]);
  resolved
    ? ok(`warden resolves ${dim(resolved.split(/\r?\n/)[0])}`)
    : warn("warden not yet resolvable by name — use the PATH fix above, or `npx warden`");

  console.log(`\n  ${c.gold(c.arrow)} ${dim("rig ready? → ")}${bold("warden onboard")}\n`);
}

/** Soft guard for commands that need a modern Node; warns, points to setup. */
function warnIfOldNode() {
  if (!nodeVersionOk()) {
    warn(
      `node ${process.versions.node} is below ${NODE_MIN.join(".")} — the worker needs node:sqlite. Run ${bold("warden setup")} for the fix.`,
    );
  }
}

/**
 * Self-update. A running dashboard/worker holds file locks inside the global
 * install, so a bare `npm i -g warden@latest` dies with EBUSY on Windows.
 * This stops the worker's child processes (NOT this CLI — the pattern matches
 * the nested node_modules the children run from), then upgrades from a cwd
 * OUTSIDE the install folder so nothing we hold can block npm's rename.
 */
async function update() {
  await banner("upgrading");
  if (process.platform === "win32") {
    // -Command text is unaffected by the .ps1 execution policy.
    const ps =
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*warden\\node_modules\\*' -and $_.ProcessId -ne " + process.pid + " } | " +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
    spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" });
  } else {
    spawnSync("sh", ["-c", "pkill -f 'warden/node_modules' 2>/dev/null || true"], { stdio: "ignore" });
  }
  ok("stopped — any running dashboard/worker was killed");

  console.log(dim("  fetching the latest…\n"));
  const r =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/c", "npm install -g warden@latest"], { stdio: "inherit", cwd: os.tmpdir() })
      : spawnSync("sh", ["-c", "npm install -g warden@latest"], { stdio: "inherit", cwd: os.tmpdir() });

  if (r.status === 0) {
    console.log(`\n  ${green("✓")} ${bold("upgraded.")} ride out again: ${bold(c.lime("warden start"))}\n`);
  } else {
    bad("upgrade failed — if it said EBUSY, close any terminal cd'd into the install folder and rerun warden update");
  }
}

/**
 * warden service install|uninstall|status — survive a logout and a reboot.
 *
 * The honest framing is repeated in the output rather than buried in docs: this
 * keeps the agent alive across logout, sleep and reboot. It cannot make it run
 * while the machine is OFF. The only real answer to that is a computer that
 * stays on — the owner's own always-on box, not us holding their keys.
 */
async function serviceCmd(sub) {
  await banner("service — keep it running");
  if (sub === "install") {
    const r = installService();
    if (!r.ok) {
      console.log(`  ${c.red("x")} couldn't install: ${r.detail}`);
      console.log(dim("    nothing was changed on your machine."));
      return;
    }
    console.log(`  ${c.green("+")} installed — ${r.detail}`);
    console.log(`
  Your agent now starts when you log in, and comes back after a reboot.

  ${bold("What this does NOT do:")} it can't run while the computer is off.
  Nothing survives that except a machine that stays on — your own always-on
  box if you want one. We're not going to hold your keys to do it for you.

  ${dim("undo any time:")} warden service uninstall`);
    return;
  }
  if (sub === "uninstall") {
    const r = uninstallService();
    console.log(r.ok ? `  ${c.green("+")} ${r.detail}` : `  ${c.gold("-")} ${r.detail}`);
    console.log(dim("    keys, settings and history untouched — only the auto-start was removed."));
    return;
  }
  const st = serviceStatus();
  if (!st.installed) {
    console.log(`  ${c.gold("-")} auto-start is not installed`);
    console.log(dim("    warden service install   — start on login, survive reboots"));
    return;
  }
  console.log(`  ${c.green("+")} installed — ${st.where}`);
  // Installed and running are different questions. Conflating them is how an
  // owner believes their agent is trading when it crashed hours ago.
  console.log(
    st.running
      ? `  ${c.green("+")} running right now`
      : `  ${c.gold("-")} installed but NOT running — it'll start at your next login`,
  );
  const tail = serviceLogTail();
  if (tail) console.log(`\n${dim("recent service log:")}\n${dim(tail)}`);
}

// ────────────────────────────────────────────────────────────────── main ──

const [, , cmd, ...rest] = process.argv;
await maybeFirstRun(cmd);
switch (cmd) {
  case "welcome":
    await welcome();
    break;
  case "setup":
    await setup();
    break;
  case "onboard":
    await onboard();
    break;
  case "start":
    await start();
    break;
  case "doctor":
    await doctor();
    break;
  case "status":
    await status();
    break;
  case "strategy":
    await strategyCmd(rest[0], rest[1]);
    break;
  case "selftest":
    selftest();
    break;
  case "service":
    await serviceCmd(rest[0]);
    break;
  case "kill":
    await kill();
    break;
  case "wallets":
    await wallets();
    break;
  case "recover":
  case "withdraw":
    await recover();
    break;
  case "update":
  case "upgrade":
    await update();
    break;
  case "version":
  case "--version":
  case "-v":
    version();
    break;
  default:
    await banner("autonomous trading agents for BSC");
    console.log(`${dim("  install: npm install -g warden · your data: ~/.warden")}

  ${bold("warden setup")}          check your rig — node, npm, PATH (with fixes)
  ${bold("warden onboard")}        set it up (keys, strategy, basket)
  ${bold("warden start")}          open the dashboard (localhost:3100) + start the worker
  ${bold("warden doctor")}         rig check — node/keys/RPC/bundler/grant/db
  ${bold("warden status")}         what the agent's up to — heartbeat, grant, trades, equity
  ${bold("warden strategy new")}   write your own in ~/.warden/strategies
  ${bold("warden strategy list")}  builtins + your strategies
  ${bold("warden selftest")}       run one policy-legal no-op through the whole pipeline
  ${bold("warden service")}        start on login, survive reboots (install/uninstall/status)
  ${bold("warden kill")}           stop everything (kill switch)
  ${bold("warden wallets")}        every wallet on this machine + what it holds
  ${bold("warden recover")}        sweep your account's funds to a wallet you control
  ${bold("warden update")}         stop, upgrade to latest, no EBUSY
  ${bold("warden version")}        which build is this (-v)
  ${bold("warden welcome")}        replay the intro

  ${c.gold(c.arrow)} ${dim("your keys, your caps · bounded worst case · every trade simulated first")}
`);
}
