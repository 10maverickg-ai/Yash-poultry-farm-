import type { RegisterReader } from "./index";
import { oldReader } from "./oldReader";

// The old reader is the default and the only one wired in. READER_V2_ENABLED
// is deliberately NOT consulted here (it must stay unset until the owner
// decides); a future reader is added by returning it from this function.
export function pickReader(): RegisterReader {
  return oldReader;
}
