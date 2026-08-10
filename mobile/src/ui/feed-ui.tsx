import { memo } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { EXPLORER } from "@/net/chainlinks";
import { usePosition, useTrade } from "@/store/selectors";
import { C } from "./tokens";

/**
 * Rows that subscribe to THEMSELVES.
 *
 * Each row takes an id, not data. It reads its own slice out of the store, so a
 * price tick on one symbol wakes one row instead of the whole list. That only
 * works because ingest preserves object identity for rows that didn't change — the
 * two halves are a single design and neither is useful alone.
 *
 * Passing the row object down as a prop instead would undo it: the list would have
 * to re-render to hand out new props, which is exactly the re-render being avoided.
 */

/** Money, with a fixed width so digits don't dance as values change. */
function usd(n: number, dp = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function shortHash(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export const PositionRowView = memo(function PositionRowView({ symbol }: { symbol: string }) {
  const p = usePosition(symbol);
  if (!p) return null;

  // A pool price cleared the depth and divergence guards, so it's actionable —
  // but it's a thinner claim than an external feed and the row says which. Never
  // render both the same way.
  const pooled = p.price_source === "pool";
  const stale = p.price_stale === 1;

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.sym}>{p.symbol}</Text>
        {/* Rendered ONLY when there is a tag. An always-present empty View still
            collects the column's `gap`, which made the left column taller than
            its one line of text — and with the row centring two unequal columns,
            the symbol then sat 8dp below the value it belongs to. Four of five
            rows drifted; the one row that happened to have a tag was the only one
            that lined up. */}
        {(pooled || stale) && (
          <View style={styles.tags}>
            {pooled && <Text style={[styles.tag, styles.tagPool]}>pool</Text>}
            {stale && <Text style={[styles.tag, styles.tagStale]}>stale</Text>}
          </View>
        )}
      </View>
      <View style={styles.rowNums}>
        <Text style={styles.value}>{usd(p.value_usdg)}</Text>
        <Text style={styles.price}>@ {usd(p.price_usd, p.price_usd < 1 ? 6 : 2)}</Text>
      </View>
    </View>
  );
});

/** How long ago, in the shortest form that stays legible at any age. */
export function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

export const TapeRowView = memo(function TapeRowView({ id }: { id: string }) {
  const t = useTrade(id);
  if (!t) return null;

  const tone =
    t.status === "landed" ? C.green : t.status === "paper" ? C.text2 : t.status === "rejected" ? C.gold : C.red;

  const what =
    t.kind === "swap"
      ? `${t.sell_token ?? "?"} → ${t.buy_token ?? "?"}`
      : t.kind.replace("vault-", "vault ");

  const openReceipt = t.tx_hash ? () => void Linking.openURL(`${EXPLORER}/tx/${t.tx_hash}`) : undefined;

  // The receipt is the whole point of a non-custodial agent, so where one exists
  // the row is the link to it. Everywhere else in the app a chain identifier is
  // tappable; the one screen that actually shows hashes was the one that made
  // them dead text.
  return (
    <Pressable
      style={styles.row}
      onPress={openReceipt}
      disabled={!openReceipt}
      accessibilityRole={openReceipt ? "link" : undefined}
      accessibilityLabel={openReceipt ? `${what}, ${t.status}, open receipt` : undefined}>
      <View style={styles.rowMain}>
        <Text style={styles.what} numberOfLines={1}>
          {what}
        </Text>
        {/* A rejected trade explains itself. "rejected" alone tells the owner
            nothing about which wall it hit. */}
        <Text style={[styles.meta, openReceipt && styles.metaLink]} numberOfLines={1}>
          {t.reject_rule ? `refused · ${t.reject_rule}` : t.tx_hash ? shortHash(t.tx_hash) : "no receipt"}
        </Text>
      </View>
      <View style={styles.rowNums}>
        <Text style={styles.value}>{usd(t.amount_usdg)}</Text>
        <View style={styles.statusLine}>
          {/* A chronological feed with no times in it is just a list. */}
          <Text style={styles.when}>{ago(t.created_at)}</Text>
          <Text style={[styles.status, { color: tone }]}>{t.status}</Text>
        </View>
      </View>
    </Pressable>
  );
});

/*
 * There used to be a second equity chart here — a bare stroked Sparkline, with
 * its own copy of the min/max/scale maths. It is gone: ui/AreaChart draws both
 * screens now.
 *
 * Two implementations of one idea is not just duplication. This one mapped the
 * series max to y=0 and sized the SVG to exactly `height`, so half the stroke
 * fell outside the viewport and the peak and trough — the two points anyone
 * looks at — rendered at half weight. The bug existed only because the geometry
 * was written twice, and only one of the two copies had tests.
 */

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    // flex-start, not center. The two columns are different heights — the right
    // is always two lines, the left is one unless it carries a tag — and centring
    // unequal columns means their first lines can never share a baseline.
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 12,
    // No horizontal padding. The list already applies the page gutter, so 4dp
    // here pushed every row 4dp inside the margin that the section heading, the
    // equity figure and the sparkline all share — while the row's own separator
    // still spanned the full width and overhung its text on both sides.
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  rowMain: { flexShrink: 1, gap: 3 },
  rowNums: { alignItems: "flex-end", gap: 3 },
  sym: { color: C.text, fontSize: 15, fontWeight: "600" },
  what: { color: C.text, fontSize: 14 },
  meta: { color: C.faint, fontSize: 11 },
  /** A hash you can open reads as an affordance, not as background noise. */
  metaLink: { color: C.dim },
  // tabular-nums so a changing figure doesn't shift the row's width.
  value: { color: C.text, fontSize: 15, fontVariant: ["tabular-nums"] },
  price: { color: C.dim, fontSize: 11, fontVariant: ["tabular-nums"] },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  when: { color: C.faint, fontSize: 11, fontVariant: ["tabular-nums"] },
  status: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  tags: { flexDirection: "row", gap: 6 },
  tag: { fontSize: 10, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: "hidden" },
  tagPool: { color: C.gold, backgroundColor: "rgba(240,185,11,0.14)" },
  tagStale: { color: C.dim, backgroundColor: "rgba(148,168,158,0.14)" },
});
