/**
 * Generate the dashboard's PWA icon set from web/public/wardenlogo.png.
 *
 * Run: node scripts/pwa-icons.mjs
 *
 * The full-res source is deliberately NOT shipped (.npmignore excludes it — it's
 * under a megabyte but still pointless to ship, since every size the app needs
 * is generated and committed instead). Regenerate only if the logo changes.
 *
 * Two shapes are needed and they are not interchangeable:
 *   any       — drawn as-is, edge to edge.
 *   maskable  — Android crops icons to a platform shape (circle, squircle,
 *               teardrop). Anything outside the middle ~80% can be cut off, so
 *               the mark is inset on a filled background. Shipping only an "any"
 *               icon is how logos end up beheaded on a Pixel launcher.
 */

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "web", "public", "wardenlogo.png");
const OUT = path.join(ROOT, "web", "public");

// Sampled from the source's own corner so the maskable padding is invisible
// rather than a guessed brand colour that doesn't quite match.
const { data } = await sharp(SRC).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
const bg = { r: data[0], g: data[1], b: data[2], alpha: 1 };
console.log(`[icons] source corner colour → rgb(${bg.r},${bg.g},${bg.b})`);

async function plain(size, name) {
  await sharp(SRC).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(path.join(OUT, name));
  console.log(`[icons] ${name} (${size}×${size})`);
}

async function maskable(size, name, inset = 0.8) {
  const inner = Math.round(size * inset);
  const pad = Math.round((size - inner) / 2);
  const logo = await sharp(SRC).resize(inner, inner, { fit: "contain", background: bg }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, name));
  console.log(`[icons] ${name} (${size}×${size}, mark inset to ${Math.round(inset * 100)}%)`);
}

await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
// iOS ignores the manifest's maskable hint and applies its own rounding, so the
// apple icon is generated full-bleed at the size iOS actually asks for.
await plain(180, "apple-touch-icon.png");
await maskable(512, "icon-maskable-512.png");
await maskable(192, "icon-maskable-192.png");
