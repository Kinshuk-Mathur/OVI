"use client";

import { Plus, Send } from "lucide-react";
import { useRef, useState } from "react";

export function ChatComposer() {
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function updateMessage(value: string) {
    setMessage(value);
    const input = inputRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    }
  }

  return (
    <div className="composer" role="group" aria-label="Message composer">
      <button className="add-button" type="button" disabled aria-label="Add attachment, coming later" title="Attachments are coming later"><Plus aria-hidden="true" /></button>
      <div className="composer-divider" />
      <label className="sr-only" htmlFor="message">Talk to OVI</label>
      <textarea ref={inputRef} id="message" value={message} onChange={(event) => updateMessage(event.target.value)} placeholder="Talk to OVI..." rows={1} />
      <button className="send-button" type="button" disabled aria-label="Send message, coming later" title="Sending messages is coming later"><Send aria-hidden="true" /></button>
    </div>
  );
}
