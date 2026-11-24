"use client";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "../user-avatar";
import { api } from "@/lib/firebase/api-client";
interface Usage {
  messages: number;
  voiceSeconds: number;
  photos: number;
  storageBytes: number;
  storageLimit: number;
  resetAt: number;
}
/** Load an owner-only summary when the account menu opens. Chat rendering never polls usage. */
export function AccountMenu({
  lock,
  fullscreen,
  toggle,
}: {
  lock: () => void;
  fullscreen: string;
  toggle?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [usage, setUsage] = useState<Usage>(),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    setUsage(undefined);
    void api("/api/account/usage", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted) setUsage(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Usage is temporarily unavailable.");
      });
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      controller.abort();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={root} className="account-menu">
      <button
        ref={trigger}
        className="account-trigger"
        aria-label="Account and usage"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <UserAvatar />
      </button>
      {open && (
        <section className="account-popover" aria-label="Account usage">
          <h2>Today’s allowance</h2>
          {usage ? (
            <>
              <dl>
                {[
                  ["Messages remaining", usage.messages],
                  [
                    "Voice remaining",
                    Math.floor(usage.voiceSeconds / 60) + "m " + (usage.voiceSeconds % 60) + "s",
                  ],
                  ["Photo uploads remaining", usage.photos],
                  [
                    "Photo storage",
                    (usage.storageBytes / 1048576).toFixed(1) +
                      " / " +
                      Math.round(usage.storageLimit / 1048576) +
                      " MB",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <small>
                Resets{" "}
                {new Date(usage.resetAt).toLocaleString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  month: "short",
                  day: "numeric",
                })}
              </small>
            </>
          ) : (
            <p role="status">{error || "Loading usage…"}</p>
          )}
          <div className="account-actions">
            {toggle && <button onClick={toggle}>{fullscreen}</button>}
            <button onClick={lock}>Lock Vault</button>
          </div>
        </section>
      )}
    </div>
  );
}
