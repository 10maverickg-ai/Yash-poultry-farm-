// The ONE interface the upload queue talks to. The queue never calls an
// extraction function directly: it calls `reader.read(...)`. The OLD reader
// (the existing Daily Production + ledger/feed pipeline) is the default and
// the only one wired in. After Phase 9, a different reader can be returned by
// `pickReader()` without touching the queue. A reader never throws — every
// failure comes back as a plain status — so an upload can never crash the queue.
export interface ReaderRequest {
  photoUrl: string;
  dateHint: string; // the date the owner said the page shows
  forceDate: string | null; // the owner's answer to a date-mismatch question
}

export interface ReaderSummary {
  date: string | null;
  flocks: { label: string; flagged: boolean; reason: string | null }[];
  unresolved: string[];
  pageIssue: string | null;
  ledgerIssue: string | null;
  ledgerFlags: string[];
  autoCorrections: number;
}

export interface ReaderResponse {
  status: "saved" | "needs_review" | "failed";
  message: string | null;
  technical: string | null;
  dateMismatch: { page: string; entered: string } | null;
  summary: ReaderSummary | null;
}

export interface RegisterReader {
  name: string;
  read(req: ReaderRequest): Promise<ReaderResponse>;
}
