/**
 * Rebuild web/public/favicon.svg to embed the robot headshot instead of the
 * old drawn shield-and-keyhole vector. Downscales+re-encodes to keep the
 * embedded base64 small (a favicon doesn't need the full-res source).
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "web", "public", "robot-mark.jpg");
const OUT = path.join(ROOT, "web", "public", "favicon.svg");

const small = await sharp(SRC).resize(128, 128, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
const b64 = small.toString("base64");

const svg = `<svg width="64" height="64" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="100" height="100" rx="22" fill="#0b0e0a"/>
  <defs>
    <clipPath id="round">
      <rect x="6" y="6" width="88" height="88" rx="18"/>
    </clipPath>
  </defs>
  <image href="data:image/jpeg;base64,${b64}" x="6" y="6" width="88" height="88" clip-path="url(#round)" preserveAspectRatio="xMidYMid slice"/>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`[favicon] wrote ${OUT} (${(svg.length / 1024).toFixed(1)}KB)`);
