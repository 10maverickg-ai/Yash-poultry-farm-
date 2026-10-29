// Draws the app icon (an original egg with a leaf, no logo or brand mark) and writes every size the phone needs.
//   npx tsx scripts/make-icons.mts
// Output goes to web/public: icons/icon-192.png, icon-512.png (rounded, "any"), icons/maskable-192.png, maskable-512.png (full square,
// artwork inside the safe circle), apple-touch-icon.png (180, full square, the iPhone rounds it itself), icons/favicon-32.png,
// favicon.ico (16, 32, 48 as PNG inside ICO) and icons/icon.svg (the source drawing). Run it again after changing the drawing below.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const GREEN = "#1d6f42"; // the app's header colour
const ART = `
  <ellipse cx="262" cy="448" rx="118" ry="14" fill="#000" opacity="0.16"/>
  <path d="M256 150 C334 150 386 238 386 312 C386 386 330 440 256 440 C182 440 126 386 126 312 C126 238 178 150 256 150 Z" fill="#fff4dc"/>
  <path d="M256 150 C334 150 386 238 386 312 C386 386 330 440 256 440 C182 440 126 386 126 312 C126 238 178 150 256 150 Z" fill="none" stroke="#e8d3a6" stroke-width="6"/>
  <ellipse cx="206" cy="262" rx="26" ry="46" fill="#fff" opacity="0.7" transform="rotate(18 206 262)"/>
  <path d="M258 152 C256 98 292 62 352 58 C356 116 320 154 258 152 Z" fill="#8fd16f"/>
  <path d="M262 148 C290 118 318 96 346 78" fill="none" stroke="#3f8f3a" stroke-width="7" stroke-linecap="round"/>
  <path d="M254 156 C232 118 196 100 160 100 C160 140 196 168 254 156 Z" fill="#6fbd5c"/>
  <path d="M250 152 C228 134 202 118 176 110" fill="none" stroke="#3f8f3a" stroke-width="6" stroke-linecap="round"/>`;

const svg = (kind: "any" | "maskable") =>
  kind === "any"
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${GREEN}"/>${ART}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${GREEN}"/><g transform="translate(256 262) scale(0.74) translate(-256 -262)">${ART}</g></svg>`;

mkdirSync("public/icons", { recursive: true });
const png = (s: string, size: number) => sharp(Buffer.from(s)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

writeFileSync("public/icons/icon.svg", svg("any"));
for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, await png(svg("any"), size));
  writeFileSync(`public/icons/maskable-${size}.png`, await png(svg("maskable"), size));
}
writeFileSync("public/apple-touch-icon.png", await png(svg("maskable"), 180));
writeFileSync("public/icons/favicon-32.png", await png(svg("any"), 32));

// favicon.ico: an ICO file whose three pictures are PNGs
const sizes = [16, 32, 48];
const pics = await Promise.all(sizes.map((s) => png(svg("any"), s)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  head.writeUInt8(s, e);
  head.writeUInt8(s, e + 1);
  head.writeUInt8(0, e + 2);
  head.writeUInt8(0, e + 3);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(pics[i].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += pics[i].length;
});
writeFileSync("public/favicon.ico", Buffer.concat([head, ...pics]));
console.log("icons written to public/ (icons/, apple-touch-icon.png, favicon.ico)");
