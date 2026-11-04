# Login, staff PIN and the home-screen app (V13)

## What it does, in plain words

- The website has **its own login**. Nobody can open any page, use any button or call any route without logging in first. The only open things are the login screen, the files that let a phone install the app (icon, manifest, offline page) and the built style/script files, none of which hold farm data.
- There is **one login box**. Type the **owner password** to see everything. Type the **staff PIN** (4 to 6 digits) and you can **only upload register photos**. There is no username.
- A phone that logs in stays logged in for **30 days of use** (it counts from the last visit). "Keep me logged in on this phone" is ticked by default; untick it on a shared phone and the login ends after 12 hours.
- If the login is **not set up**, every page says "Login is not set up yet" and shows nothing else. It never opens by mistake.

## One-time setup (the owner, about 10 minutes)

Nothing below is ever typed into a chat or saved in the code. The password never leaves your computer; only a scrambled hash is pasted into Vercel.

1. On a computer with the project, open a terminal in the `web` folder and run `npx tsx scripts/make-password-hash.mts`.
2. It asks "owner or staff?". Type **owner**. Type a NEW password when asked (at least 10 characters, not only digits: three or four words in a row are easy to remember and hard to guess). Type it again. It prints one line starting `APP_PASSWORD_HASH=`. The password does not show on screen and is not stored in your shell history.
3. Run the script again, type **staff**, and choose a 4 to 6 digit PIN (it refuses easy ones such as 0000, 1234, 1111, 4321). Copy the `APP_STAFF_PIN_HASH=` line.
4. Run `npx tsx scripts/make-secret.mts`. It prints `SESSION_SECRET=` and `CRON_SECRET=`.
5. In Vercel open the project, **Settings, Environment Variables**. Add four variables for **Production** (and Preview if you want previews to work): `APP_PASSWORD_HASH`, `APP_STAFF_PIN_HASH`, `SESSION_SECRET`, `CRON_SECRET`. Paste only the part **after** the `=`, with no quotes.
6. **Redeploy** (Deployments, the three dots, Redeploy). Settings changes do not reach a build that was already made.
7. Open the website. You should see the login box. Log in with the password. In **Settings** you will see "Staff PIN: set".

`CRON_SECRET` is what lets Vercel's daily weather job in: once it is set, Vercel sends it by itself. Without it the weather job is closed (the Settings button "Refresh weather now" still works for the owner).

## Changing things later

| What | How | Effect |
|---|---|---|
| Owner password | Make a new hash, replace `APP_PASSWORD_HASH` in Vercel, redeploy | The new password works; old owner sessions keep working until they expire (change `SESSION_SECRET` too to end them) |
| Staff PIN | Make a new staff hash, replace `APP_STAFF_PIN_HASH`, redeploy | Every staff phone is logged out at once |
| Log everyone out | Change `SESSION_SECRET`, redeploy | Owner and staff must log in again |
| Log out all staff phones now | Settings, "Log out all staff phones" | Staff phones must log in again with the PIN; the owner stays logged in |
| Someone knows the password | New hash and a new `SESSION_SECRET`, redeploy | |

## What a staff phone can do

Only these (the one list is `STAFF_ALLOWED` in `web/lib/auth/access.ts`; anything not listed there is owner-only, so a page added later is closed to staff until someone lists it):

- the **Upload** page (a date and a photo picker, a progress bar; no queue, no saved days, no flock names, no read results),
- the **upload route** (`/api/upload`: stores one photo in the queue; reading it, which costs credit, is done later from the owner's Upload page),
- the plain **"Uploaded, thank you"** page,
- **Log out**, and the **install help** page.

Everything else sends a staff phone back to the Upload page (pages) or answers 403 (everything that is not a page). This is enforced twice: before any page code runs (`web/proxy.ts`), and again inside every server action and route.

## Lock-outs

| Rule | Detail |
|---|---|
| Wrong tries | After **5 wrong tries in 15 minutes** from one address, or from one browser, that address and that browser are locked for 15 minutes ("Too many tries, wait 15 minutes."). Every wrong try also waits about a second. |
| Staff PIN, farm-wide | **20 wrong PINs in an hour from anywhere** pause PIN login for an hour ("Too many tries. Ask the owner."). The owner password keeps working, and owner-password tries are counted on their own, so guessing PINs can never lock the owner out. |
| Never reveals | The messages never say whether a guess was close. |
| Record | Every login try (time, owner password or staff PIN, success, a short hashed address code) is written to the table `login_attempts` and shown to the owner on Settings as "Recent logins". Passwords and PINs are never written anywhere. If the table is not reachable the counters are kept in memory on each server (weaker, because each server counts for itself) and Settings says so. |

## Local development

`npm run dev` on your own computer can run with the login switched off: set `LOGIN_DISABLED_FOR_DEV=1` in your **own** `.env.local` (never committed). A loud warning is printed. The switch is **ignored** by a production build (`next start`, `next build` output) and by anything running on Vercel. To try the real login locally, make a test hash and secret (as above, with a throw-away password) and set them in `.env.local`.

## Where the code is

| Part | File |
|---|---|
| Gate before every request | `web/proxy.ts`, `web/lib/auth/gate.ts` |
| Who may open what (the one list) | `web/lib/auth/access.ts` |
| Hashing (scrypt), PIN rules, session cookie | `web/lib/auth/password.ts`, `pin.ts`, `session.ts` |
| Login try, lock-outs, record | `web/lib/auth/login.ts`, `attempts.ts`, migration `db/migrations/0048_login_and_sessions.sql` |
| Second lock in actions and routes | `web/lib/auth/guard.ts` (`requireOwner()` is the first line of every server action) |
| Tests | `web/scripts/auth-check.mts` (part of `scripts/run-all.mts`) |
| Scripts | `web/scripts/make-password-hash.mts`, `web/scripts/make-secret.mts` |

## Things this does not do

- It is **one shared owner password** and one shared staff PIN, not separate accounts: the Recent logins list shows which phone or network, not which person.
- It does not change the database's own exposure: the public database role can still reach the tables directly with the project's public key (see `docs/SECURITY_V13.md`). The login protects the website, not that second door.
