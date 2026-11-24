"use client";

import { ChevronDown, History, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useVault } from "../auth/vault-provider";
import { groupHistory, historyPage, pendingHistory, type HistoryEntry } from "@/lib/conversations/history";
import type { PageCursor } from "@/lib/conversations/repository";

type Selection = { selected: string; onSelect: (id?: string) => void };
const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

function SavedChats({ selected, onSelect }: Selection) {
  const { session: { user, masterKey } } = useVault();
  const [local, setLocal] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<PageCursor>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [after, setAfter] = useState<PageCursor>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    // Read the device queue first so a chat is still selectable during an outage.
    // Read cloud headers afterwards so a queue item synced during loading cannot vanish.
    async function load() {
      try {
        if (!after) {
          const pending = await pendingHistory(user.uid, masterKey);
          if (!active) return;
          setLocal(pending);
        }
      } catch {
        if (active) setError("Device history could not be loaded.");
      }
      if (!active) return;
      try {
        const result = await historyPage(user.uid, masterKey, after);
        if (!active) return;
        setSaved((previous) => after ? [...previous, ...result.entries] : result.entries);
        setCursor(result.next);
      } catch {
        if (active) setError("Saved chats could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [user.uid, masterKey, after, attempt]);

  const groups = groupHistory(local, saved);
  return (
    <div className="history-entries" aria-label="Saved chats">
      {Array.from(groups, ([day, entries]) => (
        <section className="history-day" key={day}>
          <h3>{day}</h3>
          <ul>{entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="history-entry" aria-current={selected === entry.id ? "true" : undefined}
                onClick={() => onSelect(entry.id)}>
                <span dir="auto">{entry.title}</span>
                <time dateTime={new Date(entry.at).toISOString()}>{time.format(entry.at)}</time>
              </button>
            </li>
          ))}</ul>
        </section>
      ))}
      {loading && <p role="status">Loading chats…</p>}
      {error && <p role="status">{error} <button className="history-more" onClick={() => setAttempt((n) => n + 1)}>Retry</button></p>}
      {!loading && !error && !groups.size && <p>Your chats appear here after your first message.</p>}
      {!loading && !error && cursor && <button className="history-more" onClick={() => setAfter(cursor)}>Earlier chats</button>}
    </div>
  );
}

/** Mount the private list only while expanded. Escape or a selection closes it and returns
 * keyboard focus to the disclosure, including when the list floats over a narrow screen. */
export function ChatHistory({ selected, onSelect }: Selection) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function choose(id?: string) {
    onSelect(id);
    setOpen(false);
    toggle.current?.focus();
  }
  return (
    <div className="chat-history" ref={panel}>
      <button type="button" ref={toggle} className="nav-item history-toggle" aria-label="Chat history"
        aria-expanded={open} aria-controls="chat-history-panel" onClick={() => setOpen(!open)}>
        <History aria-hidden="true" /><span>History</span><ChevronDown className="history-chevron" aria-hidden="true" />
      </button>
      <div id="chat-history-panel" className="history-panel" hidden={!open}>
        {open && <>
          <button type="button" className="history-new" onClick={() => choose()}><SquarePen size={16} aria-hidden="true" />New chat</button>
          <SavedChats selected={selected} onSelect={choose} />
        </>}
      </div>
    </div>
  );
}
