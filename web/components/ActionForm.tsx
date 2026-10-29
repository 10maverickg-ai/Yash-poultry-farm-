"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

// A form whose answer ("Saved", or what is wrong) appears on the same screen, right under the buttons. Used where a page change after
// saving felt lost (V12 audit: the confirmation after a redirect did not always show). The inputs are passed as children.
export type FormAnswer = { ok: boolean; message: string };

export function ActionForm({ action, className, style, children }: { action: (prev: FormAnswer | null, fd: FormData) => Promise<FormAnswer>; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<FormAnswer | null, FormData>(action, null);
  // the lists on this page are server-rendered: ask for them again after a save
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} className={className} style={style} aria-busy={pending}>
      {children}
      {state && (
        <div className={state.ok ? "saved-banner" : "error-banner"} role="status" aria-live="polite" style={{ flexBasis: "100%", margin: "0.4rem 0 0" }}>
          {state.message}
        </div>
      )}
    </form>
  );
}
