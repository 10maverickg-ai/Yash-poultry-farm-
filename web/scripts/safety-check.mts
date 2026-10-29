// Safety helpers added in V12 N9: what an upload may be, and the extension that ends up in the stored path.  npx tsx scripts/safety-check.mts
import { photoProblem, safeExt, PHOTO_MAX_BYTES } from "../lib/storage.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type });

ok("a JPEG, PNG, WebP, HEIC photo is accepted", ["image/jpeg", "image/png", "image/webp", "image/heic"].every((t) => photoProblem(file("p", t)) === null));
ok("a phone that sends no type at all is accepted", photoProblem(file("IMG_1.jpg", "")) === null);
ok("a PDF, a program or a web page is refused in plain words", ["application/pdf", "application/x-msdownload", "text/html"].every((t) => /not a picture/.test(photoProblem(file("x", t)) ?? "")));
ok("a photo over 15 MB is refused with the size in the sentence", /15 MB/.test(photoProblem(file("big.jpg", "image/jpeg", PHOTO_MAX_BYTES + 1)) ?? "") && photoProblem(file("edge.jpg", "image/jpeg", PHOTO_MAX_BYTES)) === null);
ok("extension: a normal name keeps its short extension", safeExt("IMG_0001.JPG", "image/jpeg") === "jpg" && safeExt("page.heic", "") === "heic");
ok("extension: a name that tries to climb folders or add odd characters falls back to the type", safeExt("x.jpg/../../evil", "image/png") === "png" && safeExt("a.b c", "") === "jpg" && safeExt("noextension", "image/webp") === "webp" && safeExt("", "") === "jpg");
ok("extension: a very long or empty extension falls back", safeExt("photo.verylongextension", "image/heic") === "heic" && safeExt("photo.", "") === "jpg");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
