// THE ONE FILE that says who may open what. Deny by default: a page or route that is not listed here is for the owner only,
// and a staff phone is sent back to /upload (pages) or refused with 403 (everything else).

export const OWNER_HOME = "/today";
export const STAFF_HOME = "/upload";
export const LOGIN_PATH = "/login";

/** Open to everybody, no login: the login screen and its two routes, the files that make the app installable, built static files. */
export const PUBLIC_EXACT = ["/login", "/api/login", "/api/logout", "/manifest.webmanifest", "/sw.js", "/offline.html", "/favicon.ico", "/robots.txt", "/apple-touch-icon.png"];
export const PUBLIC_PREFIX = ["/_next/static/", "/icons/"];

type Method = "GET" | "HEAD" | "POST";
/** The ONLY things a staff phone may use (after login). Everything else answers staff with a redirect to /upload or a 403. */
export const STAFF_ALLOWED: { path: string; methods: readonly Method[]; what: string }[] = [
  { path: "/upload", methods: ["GET", "HEAD"], what: "the Upload page (a photo picker and nothing else)" },
  { path: "/api/upload", methods: ["POST"], what: "the upload route: stores one photo in the queue" },
  { path: "/upload/thanks", methods: ["GET", "HEAD"], what: "the plain 'Uploaded, thank you' page" },
  { path: "/install", methods: ["GET", "HEAD"], what: "the install help" },
];

export const isPublic = (pathname: string): boolean => PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p));

export function staffMay(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  return STAFF_ALLOWED.some((a) => a.path === pathname && (a.methods as readonly string[]).includes(m));
}

/** Answers that are data or files, not pages: an unauthenticated or forbidden call gets a JSON 401/403 instead of a redirect. */
export function isApiLike(pathname: string, method: string, nextAction: string | null): boolean {
  const m = method.toUpperCase();
  return pathname.startsWith("/api/") || (m !== "GET" && m !== "HEAD") || Boolean(nextAction) || /\.(csv|zip|xlsx|json|txt|png|ico|js)$/i.test(pathname) || pathname.startsWith("/export/download") || pathname.startsWith("/export/backup/zip");
}

/** Only a path inside this site, never the login screen or an API route, may be used as "go here after login". */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 300 || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return null;
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/api/")) return null;
  return next;
}
