"use client";

import { useState } from "react";

// One box for everybody (owner password or staff PIN). A plain form post to /api/login: it works without JavaScript, Enter submits it,
// and the password is never put in an address.
export function LoginForm({ next }: { next: string | null }) {
  const [show, setShow] = useState(false);
  return (
    <form action="/api/login" method="post" className="stack login-form">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="field">
        <span>Password or staff PIN</span>
        <span className="login-pw">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            required
            maxLength={200}
            autoFocus
            className="login-input"
          />
          <button type="button" className="login-eye" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Hide the password" : "Show the password"}>
            {show ? "Hide" : "Show"}
          </button>
        </span>
      </label>
      <label className="check-line">
        <input type="checkbox" name="keep" defaultChecked />
        <span>Keep me logged in on this phone</span>
      </label>
      <button type="submit" className="login-go">Log in</button>
    </form>
  );
}
