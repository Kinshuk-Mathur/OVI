"use client";

import { useState } from "react";
import { useVault } from "../auth/vault-provider";
import { IllustratedBackground } from "../illustrated-background";
import { OVISidebar } from "../ovi-sidebar";
import { UserControls } from "../user-controls";
import { clearJournal } from "@/lib/conversations/journal-selection";
import { ChatHistory } from "./chat-history";
import { Talk } from "./talk";

const newChat = () => ({ id: crypto.randomUUID(), fresh: true });

export function TalkWorkspace() {
  const { session } = useVault();
  // This selection lives only in the unlocked page. Opening the app reserves a fresh ID
  // in memory. Its first saved message creates the actual history entry.
  const [selection, setSelection] = useState(newChat);
  function select(id?: string) {
    if (id === selection.id) return;
    clearJournal(session.masterKey);
    setSelection(id ? { id, fresh: false } : newChat());
  }
  return (
    <div className="app-shell talk-shell">
      <OVISidebar>
        <ChatHistory selected={selection.id} onSelect={select} />
      </OVISidebar>
      <main className="talk-page" id="talk">
        <IllustratedBackground />
        <div className="desktop-avatar"><UserControls compact /></div>
        {/* Remounting releases the previous stream, recorder, draft and decrypted turns. */}
        <Talk key={selection.id} thread={selection.id} fresh={selection.fresh} />
      </main>
    </div>
  );
}
