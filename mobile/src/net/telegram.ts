import { isMock } from "./api";

/**
 * Telegram bridge status.
 *
 * Mirrors the GET shape of web/src/app/api/telegram/route.ts. Note what is NOT in
 * it: the bot token. That route deliberately never returns it to a client, and
 * this type exists partly to keep it that way — if a field for it ever appears
 * here, something upstream started leaking a credential.
 */
export interface TelegramStatus {
  enabled: boolean;
  connected: boolean;
  hasToken: boolean;
  botUsername: string | null;
  owner: number | null;
  allowlist: number[];
  /** Single-use code the owner sends as `/link <code>` to claim ownership. */
  linkCode: string | null;
  /**
   * Whether the chat can CHANGE anything (/pause, /kill) or only answer
   * questions. `null` when the agent is too old to report it — which is not the
   * same as "off", and the UI must not render it as either.
   */
  control: boolean | null;
}

const MOCK: TelegramStatus = {
  enabled: true,
  connected: true,
  hasToken: true,
  botUsername: "your_warden_bot",
  owner: null,
  allowlist: [],
  linkCode: "7F3K-2QD9",
  control: true,
};

export type TelegramOutcome =
  | { ok: true; status: TelegramStatus; mock: boolean }
  | { ok: false; reason: string };

export async function fetchTelegramStatus(origin: string | null, signal?: AbortSignal): Promise<TelegramOutcome> {
  if (isMock || !origin) {
    await new Promise((r) => setTimeout(r, 120));
    return { ok: true, status: MOCK, mock: true };
  }
  try {
    const res = await fetch(`${origin}/api/telegram`, { signal, headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, reason: `agent replied ${res.status}` };
    // The route's own field is `ownerId`. This client read `owner`, which the
    // route has never sent — so against a real agent the owner was ALWAYS null:
    // an owner who linked months ago still saw "Open Telegram and link" and was
    // still shown their one-time link code, on every visit, forever.
    const json = (await res.json()) as Partial<TelegramStatus> & { ownerId?: unknown };
    const ownerId = json.ownerId;
    return {
      ok: true,
      mock: false,
      status: {
        enabled: Boolean(json.enabled),
        connected: Boolean(json.connected),
        hasToken: Boolean(json.hasToken),
        botUsername: typeof json.botUsername === "string" ? json.botUsername : null,
        owner: typeof ownerId === "number" ? ownerId : null,
        allowlist: Array.isArray(json.allowlist) ? json.allowlist : [],
        linkCode: typeof json.linkCode === "string" && json.linkCode ? json.linkCode : null,
        // Tri-state on purpose. An agent predating the field sends nothing, and
        // "we don't know" must not collapse into "off" (which would hide a stop
        // that works) or "on" (which would promise one that doesn't).
        control: typeof json.control === "boolean" ? json.control : null,
      },
    };
  } catch {
    return { ok: false, reason: "couldn't reach your agent" };
  }
}

/**
 * The deep link that opens the conversation.
 *
 * `?start=` carries the link code into the chat as the bot's first message, so the
 * owner does not have to type `/link 7F3K-2QD9` by hand — which is where people
 * mistype and then wonder why the bot ignores them. Falls back to a plain t.me
 * link when there is no code yet.
 */
export function chatUrl(botUsername: string, linkCode: string | null): string {
  const base = `https://t.me/${botUsername.replace(/^@/, "")}`;
  return linkCode ? `${base}?start=${encodeURIComponent(linkCode)}` : base;
}
