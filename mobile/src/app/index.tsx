import { useMemo } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Link } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { isMock } from "@/net/api";
import {
  useAgentName,
  useCash,
  useEquity,
  useEquitySeries,
  useLastError,
  useLastOkAt,
  usePositionSymbols,
  useStrategy,
  useTapeIds,
  useVault,
} from "@/store/selectors";
import { AreaChart } from "@/ui/AreaChart";
import { PositionRowView, TapeRowView } from "@/ui/feed-ui";
import { useBottomPad, useTopPad } from "@/ui/insets";
import { C, GUTTER } from "@/ui/tokens";

/**
 * THE screen. Not "the first tab" — the only one.
 *
 * This used to be three tabs: Band (money now), Tape (what it did), Record (how
 * it has done). Three destinations for one question — "is my agent OK?" — which
 * meant the answer was never in one place and every tab had to repeat enough
 * context to stand alone. Both other tabs also drew their own equity chart from
 * the same numbers.
 *
 * So: one list. Money at the top, what it holds, what it did, in the order you
 * would ask. The Record tab's derived statistics are gone rather than moved: the
 * decisions below ARE the record, including the refused ones, and the link at
 * the bottom goes to the chain, which is the only version of the record this app
 * doesn't compute itself. A land-rate percentage we calculate is not evidence.
 *
 * ONE FlashList, not a ScrollView of two lists. Positions and decisions are both
 * unbounded, so both need recycling; nesting lists inside a scroll view gives up
 * virtualization on the inner one. A tagged row union keeps that to a single
 * pass, and getItemType keeps each kind recycling into its own kind.
 */

const W = Dimensions.get("window").width - GUTTER * 2;

/** How many decisions the home glance shows. The full history stays in the
 * store; forty rows made the screen a scroll rather than a summary. */
const RECENT = 15;

type Row =
  | { kind: "heading"; key: string; text: string }
  | { kind: "position"; key: string; symbol: string }
  | { kind: "trade"; key: string; id: string }
  | { kind: "empty"; key: string; text: string };

function money(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * How old the numbers on screen are. Rolls over past minutes because this line
 * exists for the failure case: a failed poll keeps the last good figures up, so
 * an agent unreachable for a day must say "1d ago", not "1440m ago".
 */
function age(ms: number | null): string {
  if (ms === null) return "never";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export default function Home() {
  const topPad = useTopPad();
  const bottomPad = useBottomPad();

  const equity = useEquity();
  const cash = useCash();
  const vault = useVault();
  const series = useEquitySeries();
  const symbols = usePositionSymbols();
  const tapeIds = useTapeIds();
  const name = useAgentName();
  const strategy = useStrategy();
  const lastOkAt = useLastOkAt();
  const lastError = useLastError();

  // Change across the visible window, so the headline figure has a reference
  // point instead of being a number with no context.
  const delta = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0];
    if (!first) return null;
    return ((series[series.length - 1] - first) / first) * 100;
  }, [series]);

  const rows = useMemo<Row[]>(() => {
    // Counts in the heading, so the sections are scannable without counting
    // rows — and so an empty one reads as "none" rather than as a loading bug.
    const out: Row[] = [
      { kind: "heading", key: "h-pos", text: symbols.length ? `holding · ${symbols.length}` : "holding" },
    ];
    if (symbols.length === 0) {
      out.push({
        kind: "empty",
        key: "e-pos",
        // Short. The long reassurance ("a funded agent that hasn't bought yet
        // looks exactly like this") was for a first run and read as clutter on
        // every subsequent one.
        text: lastOkAt === null ? "reading…" : "Nothing open yet.",
      });
    } else {
      for (const s of symbols) out.push({ kind: "position", key: `p-${s}`, symbol: s });
    }

    const shown = tapeIds.slice(0, RECENT);
    // Say when the list is cut. A bare "recent activity" over exactly fifteen
    // rows reads as the whole history, and the whole history is the one thing
    // this screen must never appear to be hiding.
    out.push({
      kind: "heading",
      key: "h-tape",
      text:
        tapeIds.length > shown.length
          ? `recent activity · ${shown.length} of ${tapeIds.length}`
          : tapeIds.length
            ? `recent activity · ${tapeIds.length}`
            : "recent activity",
    });
    if (tapeIds.length === 0) {
      out.push({
        kind: "empty",
        key: "e-tape",
        text: lastOkAt === null ? "reading…" : "No decisions yet — including refusals, they'll show up here.",
      });
    } else {
      for (const id of shown) out.push({ kind: "trade", key: `t-${id}`, id });
    }
    return out;
  }, [symbols, tapeIds, lastOkAt]);

  return (
    <View style={styles.root}>
      <FlashList
        data={rows}
        keyExtractor={(r) => r.key}
        getItemType={(r) => r.kind}
        renderItem={({ item }) => {
          switch (item.kind) {
            case "heading":
              return <Text style={styles.sectionTitle}>{item.text}</Text>;
            case "position":
              return <PositionRowView symbol={item.symbol} />;
            case "trade":
              return <TapeRowView id={item.id} />;
            case "empty":
              return <Text style={styles.empty}>{item.text}</Text>;
          }
        }}
        // The list re-sorts as values move, and maintainVisibleContentPosition is
        // ON by default in FlashList v2 — with re-ordering data its documented
        // behaviour is that rows visibly jump.
        maintainVisibleContentPosition={{ disabled: true }}
        contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: bottomPad }}
        ListHeaderComponent={
          <View style={[styles.header, { paddingTop: topPad }]}>
            {/* Identity and the way out, on one line. Settings used to be a
                full-width button at the very bottom of an endless feed — the
                one control on the screen, and you had to scroll past forty
                trades to reach it. */}
            <View style={styles.topRow}>
              <View style={styles.identity}>
                <Text style={styles.who} numberOfLines={1}>
                  {name ?? "your agent"}
                </Text>
                <View style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: lastError ? C.red : C.gold }]} />
                  {/* Was: "updated 3s ago · https://long.origin.example". The
                      origin is a setup detail, and it lives in Settings → data
                      where it can be read once rather than every glance. */}
                  <Text style={styles.status} numberOfLines={1}>
                    {lastError ? "stale" : "live"} · {age(lastOkAt)}
                    {strategy ? ` · ${strategy}` : ""}
                  </Text>
                </View>
              </View>
              {isMock && (
                <View style={styles.demoChip}>
                  <Text style={styles.demoText}>DEMO</Text>
                </View>
              )}
              <Link href="/settings" asChild>
                <Pressable style={styles.gear} hitSlop={10} accessibilityLabel="Settings">
                  <Ionicons name="settings-outline" size={20} color={C.dim} />
                </Pressable>
              </Link>
            </View>

            <Text style={styles.equity}>{money(equity)}</Text>
            <View style={styles.equityMeta}>
              <Text style={styles.unit}>USDT</Text>
              {delta !== null && (
                <Text style={[styles.delta, { color: delta >= 0 ? C.green : C.red }]}>
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(2)}%
                </Text>
              )}
            </View>

            <AreaChart series={series} width={W} height={64} />

            <View style={styles.split}>
              <View style={styles.splitCell}>
                <Text style={styles.splitLabel}>cash</Text>
                <Text style={styles.splitValue}>{money(cash)}</Text>
              </View>
              <View style={styles.splitCell}>
                <Text style={styles.splitLabel}>vault</Text>
                <Text style={styles.splitValue}>{money(vault)}</Text>
              </View>
            </View>

            {/* The failure the status pill can't fit. Only rendered when a read
                actually failed — the numbers above are then the LAST GOOD ones,
                and saying so is the difference between stale data and a lie. */}
            {lastError && <Text style={styles.errorNote}>Couldn&apos;t reach your agent — {lastError}</Text>}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { gap: 6, paddingBottom: 4 },
  // Name on the left, state beside it, the way out on the right. alignItems is
  // center so the gear sits against the two-line identity block rather than
  // stretching to its height and putting a 20px icon in the middle of nowhere.
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  // flexShrink, not flex:1 — a long agent name gives up width before the gear
  // does, and the gear never gets pushed off the right edge.
  identity: { flex: 1, flexShrink: 1 },
  // The agent's name is this screen's title. Knowing WHICH agent you are
  // looking at matters before any number on the page does.
  who: { color: C.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  // 44dp: the minimum touch target. The icon is 20, so the box carries the rest.
  gear: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -12 },
  demoChip: {
    backgroundColor: "rgba(240,185,11,0.12)",
    borderColor: "rgba(240,185,11,0.35)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // Was a full paragraph in a bordered box at the top of the screen, every
  // launch. One word says the same thing; Settings explains it at length.
  demoText: { color: C.gold, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  errorNote: { color: C.gold, fontSize: 12, lineHeight: 17, marginTop: 12 },
  equity: { color: C.text, fontSize: 42, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: -1 },
  equityMeta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: -4 },
  unit: { color: C.faint, fontSize: 12 },
  delta: { fontSize: 13, fontVariant: ["tabular-nums"] },
  split: { flexDirection: "row", gap: 28, marginTop: 10 },
  // flex:1 pins the columns to a grid, so the vault column doesn't slide as the
  // cash figure changes — which would throw away the tabular-nums below it.
  splitCell: { flex: 1, gap: 2 },
  splitLabel: { color: C.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  splitValue: { color: C.text2, fontSize: 15, fontVariant: ["tabular-nums"] },
  statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  status: { color: C.faint, fontSize: 11, flexShrink: 1 },
  sectionTitle: {
    color: C.dim,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    marginTop: 22,
    marginBottom: 2,
  },
  empty: { color: C.dim, fontSize: 13, lineHeight: 20, paddingVertical: 18 },
});
