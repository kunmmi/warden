/**
 * Generate the simple (non-adaptive) mobile icon assets from
 * web/public/wardenlogo.png — the same source the PWA icon generator uses.
 *
 * Run: node scripts/mobile-icons.mjs
 *
 * NOT regenerated here: mobile/assets/images/android-icon-{foreground,
 * background,monochrome}.png. Android's adaptive icon spec needs an ISOLATED
 * mark on a transparent background (foreground layer cropped to the safe
 * zone) — wardenlogo.png is a full lockup (icon + wordmark + "BUILT ON"
 * tagline) with a baked-in black background, not something that can be
 * auto-cropped into an isolated icon without guessing crop boundaries and
 * shipping something that looks broken on a real device. Needs a proper
 * isolated icon-only asset first.
 */

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "web", "public", "wardenlogo.png");
const OUT = path.join(ROOT, "mobile", "assets", "images");

async function square(size, name) {
  await sharp(SRC).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(`[mobile-icons] ${name} (${size}×${size})`);
}

await square(1024, "icon.png");
await square(512, "splash-icon.png");
await square(196, "favicon.png");
