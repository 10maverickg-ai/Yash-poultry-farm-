// Small helpers for reading optional values out of FormData: paper registers
// have blanks, so empty inputs become NULL, never 0 or ''.

// Server actions return this from useActionState: on failure the error is
// shown inline and `values` re-seeds the inputs so nothing gets retyped.
// Success never returns — the action redirects.
export type ActionState = {
  error: string;
  values: Record<string, string>;
} | null;

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function optStr(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export function optInt(fd: FormData, name: string): number | null {
  const s = optStr(fd, name);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) throw new Error(`${name} must be a whole number`);
  return n;
}

export function optNum(fd: FormData, name: string): number | null {
  const s = optStr(fd, name);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

export function optDate(fd: FormData, name: string): string | null {
  const s = optStr(fd, name);
  if (s === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${name} must be a date`);
  return s;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
