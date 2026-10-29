// What the upload route does with one photo (kept apart from the route so it can be tested without a server or storage).
// It answers with a status and a short plain message that never mentions any farm data: no dates already saved, no flock names, no
// reasons. Whether the photo is a duplicate, or needs a look, is for the owner to see on the owner's Upload page.
const iso = /^\d{4}-\d{2}-\d{2}$/;

export interface UploadDeps {
  photoProblem: (file: File) => string | null;
  store: (file: File, date: string) => Promise<string>; // returns the stored photo's address
  enqueue: (url: string, name: string | null, date: string) => Promise<unknown>;
  today: () => string;
}

export interface UploadAnswer { status: number; body: { ok: boolean; error?: string } }

const WRONG_FILE = "Choose a photo of the register page.";
const FAILED = "That photo could not be uploaded. Try again. If it keeps failing, tell the owner.";

export async function handleUpload(form: FormData | null, deps: UploadDeps): Promise<UploadAnswer> {
  const file = form?.get("photo");
  const date = form?.get("date");
  if (!(file instanceof File) || file.size === 0) return { status: 400, body: { ok: false, error: WRONG_FILE } };
  if (typeof date !== "string" || !iso.test(date)) return { status: 400, body: { ok: false, error: "Choose the date written on the page." } };
  // a date a day or more in the future is a typing slip, not a register page
  if (date > deps.today()) return { status: 400, body: { ok: false, error: "That date is in the future. Choose the date written on the page." } };
  if (deps.photoProblem(file)) return { status: 400, body: { ok: false, error: WRONG_FILE } };
  try {
    const url = await deps.store(file, date);
    await deps.enqueue(url, file.name || null, date);
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 500, body: { ok: false, error: FAILED } };
  }
}
