// Turns a raw API/network failure into one plain sentence for the owner. A raw provider message (for example
// "Your credit balance is too low to access the Anthropic API") is never shown on screen; it goes to the log.
export interface FriendlyReaderError {
  friendly: string;
  paused: boolean; // true = the reading service is unavailable, not a problem with the photo
}

const HAND = "You can enter the day by hand on the “Correct a day” screen.";

export function friendlyReaderError(err: unknown): FriendlyReaderError | null {
  const text = `${(err as { status?: number })?.status ?? ""} ${(err as { code?: string })?.code ?? ""} ${err instanceof Error ? err.message : String(err)}`;
  if (/credit balance|billing|insufficient (funds|credit)|payment required|\b402\b|purchase credits|plans & billing/i.test(text))
    return { paused: true, friendly: `Photo reading is paused (the reading service needs to be topped up). Nothing was saved. Please try again later. ${HAND}` };
  if (/invalid x-api-key|authentication|unauthori[sz]ed|permission_error|\b401\b|\b403\b|api key/i.test(text))
    return { paused: true, friendly: `Photo reading is paused (the reading service is not set up correctly). Nothing was saved. Please tell the person who looks after the app. ${HAND}` };
  if (/rate.?limit|\b429\b|overloaded|\b529\b|\b503\b|\b502\b|service unavailable|temporarily/i.test(text))
    return { paused: true, friendly: `Photo reading is busy right now. Nothing was saved. Please try again in a few minutes. ${HAND}` };
  if (/ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket hang up|timeout/i.test(text))
    return { paused: true, friendly: `The photo could not be sent to the reading service (connection problem). Nothing was saved. Please try again. ${HAND}` };
  return null;
}
