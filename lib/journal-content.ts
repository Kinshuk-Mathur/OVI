import type { JSONContent } from "@tiptap/core";
import { DEFAULT_JOURNAL_TITLE, type JournalDraft } from "./journal-storage";

export function isMeaningfulDraft(draft: JournalDraft): boolean {
  const title = draft.title.trim();
  if (title && title !== DEFAULT_JOURNAL_TITLE) return true;
  function hasContent(node: JSONContent): boolean {
    return Boolean(node.text?.trim() || node.type === "journalImage" || node.content?.some(hasContent));
  }
  return hasContent(draft.content);
}
