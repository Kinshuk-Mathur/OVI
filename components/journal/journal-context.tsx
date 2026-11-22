"use client";

import { useEffect, useState } from "react";
import { DEFAULT_JOURNAL_TITLE, getJournalDraft } from "@/lib/journal-storage";

export function JournalContext() {
  const [title, setTitle] = useState<string>();
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("context") !== "journal") return;
    let active = true;
    getJournalDraft(query.get("id") || undefined).then((draft) => {
      if (active && draft) setTitle(draft.title.trim() || DEFAULT_JOURNAL_TITLE);
    }).catch(() => { /* The chat stays usable if local storage is unavailable. */ });
    return () => { active = false; };
  }, []);
  return title ? <p className="journal-context">Talking about: <span>{title}</span></p> : null;
}
