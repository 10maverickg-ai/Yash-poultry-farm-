// Prints a salted hash for the owner password or the staff PIN, to paste into Vercel (Project Settings, Environment Variables).
//   npx tsx scripts/make-password-hash.mts
// The password is TYPED AT A PROMPT (hidden), never taken from the command line, so it does not land in shell history. Nothing is
// written to a file and nothing is sent anywhere. Only the hash is printed; the password cannot be worked back out of it.
import { createInterface } from "node:readline";
import { hashPassword } from "../lib/auth/password.ts";
import { ownerPasswordProblem, pinProblem } from "../lib/auth/pin.ts";

if (process.argv.length > 2) {
  console.error("This script takes no arguments: it asks for the password at a prompt (so it never appears in your shell history).");
  process.exit(2);
}

const tty = Boolean(process.stdin.isTTY);
const rl = tty ? null : createInterface({ input: process.stdin });
const queued: string[] = [];
let ended = false;
const waiters: ((s: string | null) => void)[] = [];
if (rl) {
  rl.on("line", (l) => (waiters.length ? waiters.shift()!(l) : queued.push(l)));
  rl.on("close", () => {
    ended = true;
    while (waiters.length) waiters.shift()!(null);
  });
}

function readPiped(): Promise<string | null> {
  if (queued.length) return Promise.resolve(queued.shift()!);
  if (ended) return Promise.resolve(null);
  return new Promise((r) => waiters.push(r));
}

function readHidden(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        } else if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(buf);
          return;
        } else if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function ask(prompt: string, hidden: boolean): Promise<string> {
  const v = tty ? (hidden ? await readHidden(prompt) : await new Promise<string>((r) => { const i = createInterface({ input: process.stdin, output: process.stdout }); i.question(prompt, (a) => { i.close(); r(a); }); })) : await readPiped();
  if (v === null) {
    console.error("\nNo more input: nothing was made.");
    process.exit(1);
  }
  return v;
}

const kind = (await ask("Is this the owner password or the staff PIN? Type owner or staff: ", false)).trim().toLowerCase();
if (kind !== "owner" && kind !== "staff") {
  console.error('Type "owner" or "staff".');
  process.exit(1);
}
const first = await ask(kind === "staff" ? "Staff PIN (4 to 6 digits): " : "Owner password (at least 10 characters, not only digits): ", true);
const problem = kind === "staff" ? pinProblem(first) : ownerPasswordProblem(first);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const again = await ask("Type it again to confirm: ", true);
if (again !== first) {
  console.error("The two entries are not the same. Nothing was made.");
  process.exit(1);
}
const hash = await hashPassword(first);
const name = kind === "staff" ? "APP_STAFF_PIN_HASH" : "APP_PASSWORD_HASH";
console.log(`\nPaste this into Vercel as ${name} (Project Settings, Environment Variables, Production), then redeploy:\n`);
console.log(`${name}=${hash}\n`);
console.log("Paste only the part after the equals sign, exactly as shown, with no quotes. Do not save the password in a file or send it in a chat.");
process.exit(0);
