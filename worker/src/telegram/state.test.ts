import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureLinkCode, rotateLinkCode, type TelegramState } from "./state";

const base: TelegramState = {
  offset: 0,
  linkCode: "",
  linkRound: 0,
  ownerId: null,
  linkedAt: null,
  messageCount: 0,
  lastNotifiedTradeId: -1,
  lastTradeDigestAt: 0,
  firedAlerts: {},
  lastDigestDate: "",
  lastJournalDate: "",
  priceAlerts: [],
  reminders: [],
  watchers: [],
  nextId: 1,
};

describe("link code — random (CSPRNG), rotating, unambiguous", () => {
  // NOT deterministic anymore, by design — see the security-history comment
  // on ensureLinkCode in state.ts. A code derivable from a known input (the
  // bot token) is only as secret as that input; randomInt() has no such
  // dependency, so there's no seed to assert reproducibility against.

  it("draws from the unambiguous alphabet only, at the right length", () => {
    const a = ensureLinkCode(base);
    assert.match(a.linkCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("does not regenerate when a code already exists", () => {
    const a = ensureLinkCode(base);
    const again = ensureLinkCode(a);
    assert.equal(again.linkCode, a.linkCode);
  });

  it("rotateLinkCode consumes the code — a used code can't link twice", () => {
    const a = ensureLinkCode(base);
    const rotated = rotateLinkCode(a);
    assert.equal(rotated.linkRound, 1);
    assert.notEqual(rotated.linkCode, a.linkCode); // fresh code, new round
    assert.match(rotated.linkCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("each rotation yields a different code", () => {
    let st = ensureLinkCode(base);
    const seen = new Set<string>([st.linkCode]);
    for (let i = 0; i < 5; i++) {
      st = rotateLinkCode(st);
      assert.ok(!seen.has(st.linkCode), `round ${st.linkRound} repeated a code`);
      seen.add(st.linkCode);
    }
  });

  it("is not derivable from any input the caller controls (no seed left to leak)", () => {
    // Two independent draws must not collide — if they did across a large
    // sample it would suggest a shared, guessable seed rather than real
    // per-call entropy. 200 draws from a 32^6 keyspace collided is
    // astronomically unlikely if and only if this is genuinely random.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = ensureLinkCode({ ...base, linkCode: "" }).linkCode;
      assert.ok(!seen.has(code), "collision suggests non-random generation");
      seen.add(code);
    }
  });
});
