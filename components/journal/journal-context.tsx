"use client";

import { useEffect, useState } from "react";
import { DEFAULT_JOURNAL_TITLE } from "@/lib/journal-storage";
import { useJournalWorkspace } from "./journal-provider";

export function JournalContext() {
  const workspace = useJournalWorkspace();
  const [title, setTitle] = useState<string>();
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("context") !== "journal") return;
    let active = true;
    const id = query.get("id");
    if (!id) return;
    workspace.open(id, false).then(({ draft }) => {
      if (active && draft) setTitle(draft.title.trim() || DEFAULT_JOURNAL_TITLE);
    }).catch(() => { /* The chat stays usable if local storage is unavailable. */ });
    return () => { active = false; };
  }, [workspace]);
  return title ? <p className="journal-context">Talking about: <span>{title}</span></p> : null;
}
