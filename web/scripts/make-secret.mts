// Prints two fresh random secrets for Vercel (Project Settings, Environment Variables, Production):
//   SESSION_SECRET  signs the login cookies. Changing it logs everybody out.
//   CRON_SECRET     lets Vercel's daily weather job in (Vercel sends it automatically once it is set).
//   npx tsx scripts/make-secret.mts
// Nothing is written to a file. Run it again for new ones.
import { randomBytes } from "node:crypto";

const make = () => randomBytes(32).toString("base64url");
console.log("\nPaste each value into Vercel under its own name, then redeploy:\n");
console.log(`SESSION_SECRET=${make()}`);
console.log(`CRON_SECRET=${make()}\n`);
console.log("Paste only the part after the equals sign. Keep them private; do not send them in a chat.");
