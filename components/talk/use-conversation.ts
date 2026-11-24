"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVault } from "../auth/vault-provider";
import { api, ApiError, jsonPost } from "@/lib/firebase/api-client";
import {
  checkpointMessage,
  earlierMessages,
  pendingMessages,
  pendingThreads,
  syncOutbox,
  watchMessages,
  type ChatMessage,
  type PageCursor,
} from "@/lib/conversations/repository";
import { readReply } from "@/lib/conversations/stream-client";
import { clearJournal, selectedJournal } from "@/lib/conversations/journal-selection";

function merge(previous: ChatMessage[], incoming: ChatMessage[]) {
  const rows = new Map(previous.map((m) => [m.id, m]));
  for (const m of incoming) rows.set(m.id, m);
  return [...rows.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
/** The unlocked view owns all plaintext and aborts inference on unmount. Sync retries replay
 * encrypted records only. They must never initiate a second generation or spend more quota. */
export function useConversation(thread: string, fresh: boolean) {
  const {
      session: { user, masterKey },
    } = useVault(),
    uid = user.uid;
  const [rows, setRows] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(fresh),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState("");
  const [partial, setPartial] = useState<string | null>(null),
    [working, setWorking] = useState(false);
  const [journal, setJournal] = useState(() => selectedJournal(masterKey));
  const [retryable, setRetryable] = useState(false);
  const [more, setMore] = useState(false);
  const cursor = useRef<PageCursor>(null),
    paged = useRef(false),
    loadingPage = useRef(false);
  const operation = useRef<AbortController>(null),
    mounted = useRef(true);
  const sync = useCallback(
    async (id: string) => {
      try {
        await syncOutbox(uid, masterKey, id);
        if (mounted.current) setSyncError("");
      } catch {
        if (mounted.current) setSyncError("Saved on this device. Cloud sync is pending.");
      }
    },
    [uid, masterKey],
  );
  useEffect(() => {
    mounted.current = true;
    let active = true,
      stop = () => {},
      retry: ReturnType<typeof setTimeout>;
    const restore = async () => {
      try {
        const pending = await pendingMessages(uid, masterKey, thread);
        if (!active) return;
        setRows((old) => merge(old, pending));
        stop = watchMessages(
          uid,
          masterKey,
          thread,
          (page) => {
            if (!active) return;
            setRows((old) => merge(old, page.rows));
            setReady(true);
            if (!paged.current) {
              cursor.current = page.cursor ?? null;
              setMore(page.more);
            }
          },
          () => {
            if (active)
              setSyncError("Your saved conversation could not be loaded. Reopen Talk to OVI to retry.");
          },
        );
      } catch {
        if (active) {
          setSyncError("Reconnecting to your encrypted conversation…");
          retry = setTimeout(restore, 5000);
        }
      }
    };
    void restore();
    // A fresh page no longer selects yesterday's thread. Continue delivering its queued
    // ciphertext on reconnect, without loading that conversation into the new chat.
    let replaying = false;
    const retrySync = async () => {
      if (replaying) return;
      replaying = true;
      try {
        for (const id of await pendingThreads(uid)) {
          if (!active) break;
          if (id === thread) await sync(id);
          else await syncOutbox(uid, masterKey, id).catch(() => {});
        }
      } catch {
        // IndexedDB can be temporarily unavailable. The next reconnect or timer retries.
      } finally {
        replaying = false;
      }
    };
    void retrySync();
    const timer = setInterval(retrySync, 30000);
    window.addEventListener("online", retrySync);
    return () => {
      active = false;
      mounted.current = false;
      clearTimeout(retry);
      clearInterval(timer);
      stop();
      operation.current?.abort();
      window.removeEventListener("online", retrySync);
    };
  }, [uid, masterKey, sync, thread]);
  function removeJournal() {
    clearJournal(masterKey);
    setJournal(undefined);
  }
  /** Fetch one older page and merge by immutable ID to tolerate overlap with the live listener. */
  async function older() {
    if (!cursor.current || loadingPage.current) return;
    loadingPage.current = true;
    try {
      const page = await earlierMessages(uid, masterKey, thread, cursor.current);
      paged.current = true;
      cursor.current = page.cursor ?? null;
      setMore(page.more);
      setRows((old) => merge(old, page.rows));
    } catch {
      setError("Earlier messages could not be loaded.");
    } finally {
      loadingPage.current = false;
    }
  }
  /** Commit the user turn before inference. A manual reply retry reuses that turn, while
   * issuing a fresh provider request ID. Persist assistant text only after the completion frame. */
  async function send(text: string, accepted: () => void, retry?: ChatMessage) {
    if (operation.current || !ready || !text.trim()) return;
    const controller = new AbortController();
    operation.current = controller;
    setWorking(true);
    setError("");
    setRetryable(false);
    setPartial(null);
    const message: ChatMessage = retry ?? {
      id: crypto.randomUUID(),
      at: Date.now(),
      role: "user",
      text: text.trim(),
    };
    let frame = 0;
    try {
      if (!retry) {
        await checkpointMessage(uid, masterKey, thread, message);
        controller.signal.throwIfAborted();
        setRows((old) => merge(old, [{ ...message, pending: true }]));
        accepted();
        void sync(thread);
      }
      const payload = {
        requestId: crypto.randomUUID(),
        message: message.text,
        history: rows
          .filter((m) => m.id !== message.id)
          .slice(-16)
          .map((m) => ({ role: m.role, content: m.text })),
        ...(journal ? { journal: journal.text } : {}),
      };
      setPartial("");
      const response = await api("/api/ai/chat", jsonPost(payload, controller.signal));
      if (journal) removeJournal();
      // Coalesce network deltas into at most one React update per animation frame.
      let latest = "";
      const reply = await readReply(response, (full) => {
        latest = full;
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            setPartial(latest);
          });
      });
      controller.signal.throwIfAborted();
      cancelAnimationFrame(frame);
      frame = 0;
      const answer: ChatMessage = {
        id: crypto.randomUUID(),
        at: Math.max(Date.now(), message.at + 1),
        role: "assistant",
        text: reply,
      };
      await checkpointMessage(uid, masterKey, thread, answer);
      if (mounted.current) {
        setRows((old) => merge(old, [answer]));
        setPartial(null);
        void sync(thread);
      }
    } catch (err) {
      if (mounted.current) {
        setRetryable(!(err instanceof ApiError && ["quota_config", "provider_config", "auth_service", "auth", "route"].includes(err.code)));
        setError(
          controller.signal.aborted
            ? "Reply stopped."
            : err instanceof Error
              ? err.message
              : "OVI could not reply.",
        );
        setPartial((old) => old || null);
      }
    } finally {
      cancelAnimationFrame(frame);
      operation.current = null;
      if (mounted.current) setWorking(false);
    }
  }
  return {
    rows,
    ready,
    working,
    partial,
    error,
    syncError,
    setError: (notice: string) => { setRetryable(false); setError(notice); },
    retryable,
    more,
    older,
    send,
    stop: () => operation.current?.abort(),
    journal,
    removeJournal,
  };
}
