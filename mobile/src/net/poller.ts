import { useEffect } from "react";
import { AppState } from "react-native";
import { fetchFeed } from "./api";
import { ingest, ingestError } from "@/store/feedStore";

/**
 * ONE poller for the whole app, and it stops when nobody is looking.
 *
 * Two mistakes this is shaped to avoid:
 *
 *   A poller per screen. Mount the same hook on the dashboard and the tape and you get
 *   two intervals fetching the same payload, doubling work and producing
 *   interleaved writes to the store.
 *
 *   A poller that runs in the background. On a phone that is battery burn for data
 *   nobody can see, and on resume you get a thundering pile of queued timers.
 *   AppState gating means backgrounding genuinely stops the work.
 *
 * Mounted once, in the root layout. Screens read the store; they never fetch.
 */

const INTERVAL_MS = 4_000;

export function useFeedPoller(): void {
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      controller?.abort();
      controller = null;
    };

    const loop = async () => {
      if (!alive || AppState.currentState !== "active") return;
      controller = new AbortController();
      try {
        const res = await fetchFeed(controller.signal);
        if (!alive) return;
        ingest(res);
      } catch (e) {
        if (!alive) return;
        // An aborted request is us, not a failure — don't report it as one.
        if (e instanceof Error && e.name === "AbortError") return;
        // Keep whatever is on screen. A missed poll is not news about the
        // portfolio, so the numbers stay and the UI marks them stale instead.
        ingestError(e instanceof Error ? e.message : "feed unreachable");
      } finally {
        controller = null;
        // setTimeout chained after completion, not setInterval: a slow poll must
        // not overlap the next one, or a stall turns into a pile-up.
        if (alive && AppState.currentState === "active") timer = setTimeout(loop, INTERVAL_MS);
      }
    };

    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (!timer) void loop();
      } else {
        stop();
      }
    });

    void loop();

    return () => {
      alive = false;
      stop();
      sub.remove();
    };
  }, []);
}
