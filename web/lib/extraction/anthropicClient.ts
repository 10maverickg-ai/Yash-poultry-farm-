import Anthropic from "@anthropic-ai/sdk";

// Same lazy-init lesson as lib/db.ts and lib/storage.ts.
let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Configure it in the deployment " +
        "environment and redeploy — env var edits do not apply to " +
        "already-built deployments."
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

export const EXTRACTION_MODEL = "claude-sonnet-5";
