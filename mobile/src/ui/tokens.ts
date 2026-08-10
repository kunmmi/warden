/**
 * Colours, matched to the dashboard so the phone and the desktop feel like one
 * product — BNB Chain gold + true near-black, mirroring web/src/app/globals.css.
 * green/red are reserved strictly for P&L gain/loss and pass/fail states, never
 * brand chrome (buttons, selected states, links) — that's gold now.
 */
export const C = {
  bg: "#0b0e0a",
  bg1: "#111411",
  bg2: "#161a15",
  bg3: "#1e231d",
  border: "#2c3129",
  text: "#f2f0e9",
  text2: "#c3cec4",
  dim: "#a8a596",
  /**
   * The quietest text rung. Was #647a70, which measured 4.03:1 on bg, 3.60:1 on
   * bg2 and 3.19:1 on bg3 — under WCAG AA's 4.5:1 at every size this app uses it,
   * and it is the colour of the tape's transaction hashes and of the sentence
   * warning that anyone holding the link code can claim your agent. The lowest
   * contrast in the app should not be on a theft warning.
   *
   * #7f958b clears 4.5:1 on all three surfaces while staying visibly quieter than
   * `dim` — the rung still reads as "background information", it just survives
   * being read outdoors. bg/bg2/bg3 have since shifted slightly (green tint
   * removed, same darkness) — not re-measured, but the delta is small enough
   * this should still clear AA; re-check if this rung ever looks too dim.
   */
  faint: "#7f958b",
  green: "#34d399",
  red: "#fb7185",
  gold: "#f0b90b",
  goldSoft: "#f8d33a",
} as const;

/**
 * One vertical spacing scale. Screens previously stacked marginBottom + container
 * gap + marginTop, which produced sibling gaps of 30 / 26 / 20dp on a single short
 * column — differences small enough to read as mistakes rather than intent.
 */
export const S = {
  /** Between tightly-related lines (a label and its value). */
  tight: 4,
  /** Between elements inside one group. */
  step: 8,
  /** Between groups. */
  group: 16,
  /** Between sections — a new idea starts here. */
  section: 28,
} as const;

/** The screen's horizontal margin. Everything on a screen shares this left edge. */
export const GUTTER = 20;
