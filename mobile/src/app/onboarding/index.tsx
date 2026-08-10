import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { accountFromMnemonic, buildQuiz, newMnemonic, validateMnemonic } from "@/crypto/mnemonic";
import { keystoreAvailable, writeOwner } from "@/crypto/keystore";
import { useBottomPad, useTopPad } from "@/ui/insets";
import { useNoScreenshots } from "@/ui/useNoScreenshots";
import { C } from "@/ui/tokens";

/**
 * Step one of two: get a key. (Step two is the wall.)
 *
 * This was two routes — choose-or-import, then a separate backup screen — which
 * made "make a key" look like two things and duplicated the whole stylesheet.
 * It is one screen with four stages now, and the stages are strictly sequential,
 * so there is no navigation to reason about and no phrase passed through a
 * route parameter.
 *
 * NOTHING IS PERSISTED UNTIL THE QUIZ PASSES. That ordering is the whole point:
 * per worker/src/recover.ts the owner key is the ONLY thing that can sweep a
 * smart account, so a key saved before its backup is confirmed is funds with a
 * single point of failure the owner cannot see — and on a phone-only product
 * that point of failure is "drops phone in a canal". A key discarded because
 * someone bailed halfway costs nothing.
 *
 * Importing is different and saves immediately: the owner already has the phrase
 * written down, by definition, so re-quizzing them would be theatre.
 */

type Stage = "choose" | "import" | "write" | "quiz";

export default function OnboardingStart() {
  const topPad = useTopPad();
  const bottomPad = useBottomPad();
  const [stage, setStage] = useState<Stage>("choose");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [quiz, setQuiz] = useState<ReturnType<typeof buildQuiz>>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Block screenshots and screen recording while the phrase is on screen.
   *
   * FLAG_SECURE on Android, and it also blanks the recents thumbnail — which is
   * the failure that needs no attacker at all: the OS snapshots the screen as
   * the app backgrounds, and the thing on screen at that moment is twelve words
   * that move the money. A no-op on web, where the preview runs.
   *
   * Hooks cannot be called conditionally, so this covers the whole screen
   * rather than only the two stages that render words. The cost is that
   * "choose" and "import" are also uncapturable, which nobody will notice.
   */
  useNoScreenshots("onboarding");

  const words = useMemo(() => (mnemonic ?? "").split(" ").filter(Boolean), [mnemonic]);

  /**
   * Drop the phrase from memory the moment the app leaves the foreground.
   *
   * settings.tsx already does this for its reveal; this screen — the one where
   * the phrase FIRST appears, and the only place it exists before anything is
   * persisted — did not. Sending the user back to "choose" is deliberate: the
   * key was never written to the keystore at this stage (see the header), so
   * there is nothing to clean up and nothing lost but a few taps.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") return;
      setMnemonic(null);
      setTyped("");
      setQuiz([]);
      setAnswers({});
      // Only the generated-key stages go back to the start. An importer who
      // switches to their password manager and returns must land on the import
      // field they left, not at the top — the typed text is cleared either way,
      // and a paste on return still works.
      setStage((st) => (st === "write" || st === "quiz" ? "choose" : st));
    });
    return () => sub.remove();
  }, []);

  const create = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!(await keystoreAvailable())) {
        setError("This device has no secure keystore, so a key can't be stored safely here.");
        return;
      }
      // Held in memory only. Committed in `confirm`, once the quiz passes.
      setMnemonic(newMnemonic());
      setStage("write");
    } finally {
      setBusy(false);
    }
  }, []);

  const restore = useCallback(async () => {
    setError(null);
    const check = validateMnemonic(typed);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setBusy(true);
    try {
      if (!(await keystoreAvailable())) {
        setError("This device has no secure keystore, so a key can't be stored safely here.");
        return;
      }
      await writeOwner(check.mnemonic);
      router.replace("/onboarding/grant");
    } catch {
      setError("Couldn't save to the keychain. Try again.");
    } finally {
      setBusy(false);
    }
  }, [typed]);

  const confirm = useCallback(async () => {
    const wrong = quiz.filter((q) => answers[q.index] !== q.answer);
    if (wrong.length > 0) {
      // Re-roll the questions. Otherwise a wrong answer becomes a two-guess
      // multiple choice, which proves nothing.
      setError(
        `${wrong.length === 1 ? "One word is" : `${wrong.length} words are`} wrong. Check your copy — here are three fresh questions.`,
      );
      setQuiz(buildQuiz(mnemonic!, 3));
      setAnswers({});
      return;
    }
    setBusy(true);
    try {
      await writeOwner(mnemonic!);
      router.replace("/onboarding/grant");
    } catch {
      setError("Couldn't save to the keychain. Try again.");
    } finally {
      setBusy(false);
    }
  }, [quiz, answers, mnemonic]);

  const preview = (() => {
    const check = validateMnemonic(typed);
    if (!check.ok) return null;
    try {
      return accountFromMnemonic(check.mnemonic).address;
    } catch {
      return null;
    }
  })();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: topPad, paddingBottom: bottomPad }]}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled">
      {stage === "choose" && (
        <>
          <Text style={styles.h1}>Your key, your machine</Text>
          <Text style={styles.lede}>
            warden creates a key that lives only on this phone. It signs the permission wall your agent
            trades inside — and it is the only thing that can ever move your funds back out.
          </Text>

          <Pressable style={styles.primary} disabled={busy} onPress={create}>
            {busy ? <ActivityIndicator color="#08120e" /> : <Text style={styles.primaryText}>Create a new key</Text>}
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => setStage("import")}>
            <Text style={styles.secondaryText}>I already have a recovery phrase</Text>
          </Pressable>
          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.note}>
            <Text style={styles.noteText}>
              Next you&apos;ll be shown twelve words and asked to prove you wrote them down. That step
              can&apos;t be skipped, because those words are the only way back if this phone is lost or wiped.
            </Text>
          </View>
        </>
      )}

      {stage === "import" && (
        <>
          <Text style={styles.h1}>Your key, your machine</Text>
          <Text style={styles.label}>Recovery phrase</Text>
          <TextInput
            style={styles.input}
            value={typed}
            onChangeText={(t) => {
              setTyped(t);
              setError(null);
            }}
            placeholder="twelve words, separated by spaces"
            placeholderTextColor={C.faint}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            // Keeps the phrase out of the keyboard's learned-words dictionary.
            autoComplete="off"
            spellCheck={false}
            textContentType="none"
          />
          {preview && (
            <Text style={styles.preview}>
              owner address <Text style={styles.previewAddr}>{preview}</Text>
            </Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={styles.primary} disabled={busy} onPress={restore}>
            {busy ? <ActivityIndicator color="#08120e" /> : <Text style={styles.primaryText}>Restore</Text>}
          </Pressable>
          <Pressable style={styles.ghost} onPress={() => setStage("choose")}>
            <Text style={styles.ghostText}>back</Text>
          </Pressable>
        </>
      )}

      {stage === "write" && (
        <>
          <Text style={styles.h1}>Write these down</Text>
          <Text style={styles.lede}>
            Twelve words, in this order. They are the only way to reach your funds if this phone is lost,
            wiped, or stops working. Nobody can send them to you again — not us, not anyone.
          </Text>

          <View style={styles.grid}>
            {words.map((w, i) => (
              <View key={`${i}-${w}`} style={styles.wordCell}>
                <Text style={styles.wordIndex}>{i + 1}</Text>
                <Text style={styles.word}>{w}</Text>
              </View>
            ))}
          </View>

          <View style={styles.warn}>
            <Text style={styles.warnText}>
              Paper beats screenshots. A photo in your camera roll syncs to the cloud, and anyone who reaches
              that reaches your money.
            </Text>
          </View>

          {/*
            There WAS a "copy to clipboard" button here, whose own label read
            "copied — clear your clipboard after". It is gone, because that
            instruction is not something a user can reliably carry out.

            Android's clipboard is shared, and expo-clipboard cannot mark a clip
            sensitive: ClipboardModule.kt calls ClipData.newPlainText(null,
            content) and never touches setExtras, so ClipDescription's
            EXTRA_IS_SENSITIVE is never set — and SetStringOptions has exactly
            one field, inputFormat. The phrase would therefore sit in the
            keyboard's clipboard history, be shown verbatim in the system's copy
            confirmation, and be readable by whichever app next took focus.

            That is the one string in this product that alone can move the
            money, and the paragraph directly above says paper beats
            screenshots. The quiz on the next stage already proves the words
            were transcribed, so nothing here needed a shortcut.
          */}
          <Pressable
            style={styles.primary}
            onPress={() => {
              // Questions are chosen AFTER they tap, so screenshotting the quiz
              // itself doesn't help.
              setQuiz(buildQuiz(mnemonic!, 3));
              setAnswers({});
              setError(null);
              setStage("quiz");
            }}>
            <Text style={styles.primaryText}>I&apos;ve written them down</Text>
          </Pressable>
        </>
      )}

      {stage === "quiz" && (
        <>
          <Text style={styles.h1}>Prove it</Text>
          <Text style={styles.lede}>
            Three words from the phrase you just saved. This is the only way to know the backup is real before
            money depends on it.
          </Text>

          {quiz.map((q) => (
            <View key={q.index} style={styles.question}>
              <Text style={styles.qLabel}>Word #{q.index + 1}</Text>
              <View style={styles.options}>
                {q.options.map((opt) => {
                  const selected = answers[q.index] === opt;
                  return (
                    <Pressable
                      key={opt}
                      style={[styles.option, selected && styles.optionOn]}
                      onPress={() => setAnswers((a) => ({ ...a, [q.index]: opt }))}>
                      <Text style={[styles.optionText, selected && styles.optionTextOn]}>{opt}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.primary, Object.keys(answers).length < quiz.length && styles.primaryOff]}
            disabled={busy || Object.keys(answers).length < quiz.length}
            onPress={confirm}>
            {busy ? <ActivityIndicator color="#08120e" /> : <Text style={styles.primaryText}>Confirm and continue</Text>}
          </Pressable>

          <Pressable style={styles.ghost} onPress={() => setStage("write")}>
            <Text style={styles.ghostText}>show the words again</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 24, gap: 14 },
  h1: { color: C.text, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  lede: { color: C.dim, fontSize: 15, lineHeight: 22, marginBottom: 10 },
  primary: {
    backgroundColor: C.gold,
    borderRadius: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryOff: { opacity: 0.4 },
  primaryText: { color: "#08120e", fontSize: 16, fontWeight: "700" },
  secondary: {
    backgroundColor: C.bg2,
    borderRadius: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryText: { color: C.text2, fontSize: 15 },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghostText: { color: C.faint, fontSize: 13 },
  note: { backgroundColor: C.bg2, borderRadius: 12, padding: 14, marginTop: 12 },
  noteText: { color: C.dim, fontSize: 13, lineHeight: 20 },
  label: { color: C.faint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    color: C.text,
    padding: 14,
    minHeight: 110,
    fontSize: 15,
    textAlignVertical: "top",
  },
  preview: { color: C.dim, fontSize: 12 },
  previewAddr: { color: C.text2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  wordCell: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 7,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: "30%",
  },
  wordIndex: { color: C.faint, fontSize: 11, fontVariant: ["tabular-nums"] },
  word: { color: C.text, fontSize: 15, fontWeight: "600" },
  warn: {
    backgroundColor: "rgba(240,185,11,0.12)",
    borderColor: "rgba(240,185,11,0.35)",
    borderWidth: 1,
    borderRadius: 12,
    padding: 13,
  },
  warnText: { color: C.gold, fontSize: 13, lineHeight: 19 },
  question: { gap: 8 },
  qLabel: { color: C.dim, fontSize: 13, fontWeight: "600" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: "center",
  },
  optionOn: { borderColor: C.gold, backgroundColor: "rgba(240,185,11,0.12)" },
  optionText: { color: C.text2, fontSize: 14 },
  optionTextOn: { color: C.gold, fontWeight: "600" },
  error: { color: C.red, fontSize: 13, lineHeight: 19 },
});
