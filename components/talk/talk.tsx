"use client";
/** Render the approved welcome until the first stored message, then place the conversation above a persistent composer. */
import { JournalContext } from "../journal/journal-context";
import { useEffect, useLayoutEffect, useRef } from "react";
import { FlowerMark } from "../ovi-logo";
import { Greeting } from "../greeting";
import { ChatComposer } from "../chat-composer";
import { useConversation } from "./use-conversation";

function Bubble({ role, text }: { role: "assistant" | "user"; text: string }) {
  return (
    <article aria-label={role === "user" ? "You" : "OVI"} className={"chat-row " + role}>
      {role === "assistant" && (
        <span className="chat-avatar">
          <FlowerMark />
        </span>
      )}
      <div className="chat-bubble" dir="auto">
        {text || (
          <span className="typing" role="status" aria-label="OVI is writing">
            •••
          </span>
        )}
      </div>
    </article>
  );
}
export function Talk({ thread, fresh }: { thread: string; fresh: boolean }) {
  const chat = useConversation(thread, fresh),
    active = chat.rows.length > 0;
  const region = useRef<HTMLDivElement>(null),
    pinned = useRef(true),
    anchor = useRef<{ id: string; top: number }>(null);
  const last = chat.rows.at(-1);
  // Keep a visible message anchored when older pages are prepended. Streaming only follows the
  // bottom while the reader is already there, so reading an earlier reply is uninterrupted.
  useLayoutEffect(() => {
    const el = region.current;
    if (!el) return;
    if (anchor.current) {
      const row = document.getElementById(anchor.current.id);
      if (row) el.scrollTop += row.getBoundingClientRect().top - anchor.current.top;
      anchor.current = null;
    } else if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [chat.rows, chat.partial]);
  useEffect(() => {
    const vv = window.visualViewport;
    const size = () => {
      document.documentElement.style.setProperty("--talk-height", (vv?.height ?? window.innerHeight) + "px");
      document.documentElement.style.setProperty("--talk-offset", (vv?.offsetTop ?? 0) + "px");
    };
    size();
    vv?.addEventListener("scroll", size);
    vv?.addEventListener("resize", size);
    window.addEventListener("resize", size);
    return () => {
      document.documentElement.style.removeProperty("--talk-offset");
      vv?.removeEventListener("scroll", size);
      vv?.removeEventListener("resize", size);
      window.removeEventListener("resize", size);
      document.documentElement.style.removeProperty("--talk-height");
    };
  }, []);
  return (
    <div className={active ? "conversation" : "welcome-content"}>
      {active ? (
        <div
          className="chat-scroll"
          ref={region}
          role="region"
          aria-label="Conversation history"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.clientHeight - el.scrollTop < 96;
          }}
        >
          <div className="chat-column">
            {chat.more && (
              <button
                className="earlier"
                onClick={() => {
                  const first = document.getElementById("turn-" + chat.rows[0].id);
                  if (first) anchor.current = { id: first.id, top: first.getBoundingClientRect().top };
                  void chat.older();
                }}
              >
                Earlier messages
              </button>
            )}
            {chat.rows.map((m) => (
              <div id={"turn-" + m.id} key={m.id}>
                <Bubble role={m.role} text={m.text} />
              </div>
            ))}
            {chat.partial !== null && <Bubble role="assistant" text={chat.partial} />}
          </div>
        </div>
      ) : !fresh && !chat.ready ? (
        <p role="status">Opening conversation…</p>
      ) : (
        <Greeting />
      )}
      <div className="composer-dock">
        {chat.journal && <JournalContext journal={chat.journal} remove={chat.removeJournal} />}
        {(chat.error || chat.syncError) && (
          <p className="chat-notice" role="status">
            {chat.error || chat.syncError}
            {chat.retryable && chat.error && last?.role === "user" && !chat.working && (
              <button onClick={() => void chat.send(last.text, () => {}, last)}>Try reply again</button>
            )}
          </p>
        )}
        <ChatComposer
          ready={chat.ready}
          working={chat.working}
          stop={chat.stop}
          send={(s, accepted) =>
            void chat.send(s, () => {
              pinned.current = true;
              accepted();
            })
          }
          report={chat.setError}
        />
      </div>
    </div>
  );
}
