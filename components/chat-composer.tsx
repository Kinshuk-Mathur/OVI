"use client";
import { Plus, Send, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { VoiceButton } from "./talk/voice-button";

/** Voice and keyboard share the same editable draft. Stopping a recording only inserts text. */
export function ChatComposer({
  ready,
  working,
  send,
  stop,
  report,
}: {
  ready: boolean;
  working: boolean;
  send: (value: string, accepted: () => void) => void;
  stop: () => void;
  report: (message: string) => void;
}) {
  const [message, setMessage] = useState(""),
    [voiceBusy, setVoiceBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = input.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }
  }, [message]);
  function submit() {
    if (!working && !voiceBusy && ready && message.trim())
      send(message, () => setMessage((old) => (old === message ? "" : old)));
  }
  return (
    <form
      className="composer"
      aria-label="Message composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <button
        className="add-button"
        type="button"
        disabled
        aria-label="Attachments unavailable"
        title="Attachments are unavailable"
      >
        <Plus />
      </button>
      <div className="composer-divider" />
      <label className="sr-only" htmlFor="message">
        Talk to OVI
      </label>
      <textarea
        id="message"
        ref={input}
        rows={1}
        value={message}
        maxLength={12000}
        placeholder="Talk to OVI..."
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.nativeEvent.keyCode !== 229
          ) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <VoiceButton
        disabled={working}
        report={report}
        onBusy={setVoiceBusy}
        insert={(text) => {
          setMessage((old) => (old ? old + " " + text : text));
          input.current?.focus();
        }}
      />
      {working ? (
        <button className="send-button" type="button" aria-label="Stop reply" onClick={stop}>
          <Square size={20} />
        </button>
      ) : (
        <button
          className="send-button"
          type="submit"
          disabled={!ready || voiceBusy || !message.trim()}
          aria-label="Send message"
        >
          <Send />
        </button>
      )}
    </form>
  );
}
