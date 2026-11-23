"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useVault } from "@/components/auth/vault-provider";
import { JournalWorkspace } from "@/lib/journal/workspace";
const Context = createContext<JournalWorkspace | null>(null);
export function JournalProvider({ children }: { children: ReactNode }) {
  const { session } = useVault();
  const [workspace] = useState(() => new JournalWorkspace(session.user.uid, session.masterKey));
  useEffect(() => { workspace.start(); return () => workspace.close(); }, [workspace]);
  return <Context.Provider value={workspace}>{children}</Context.Provider>;
}
export function useJournalWorkspace() { const workspace = useContext(Context); if (!workspace) throw new Error("Journal workspace is unavailable."); return workspace; }
