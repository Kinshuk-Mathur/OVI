import type { JSONContent } from "@tiptap/core";
/** Explicit editor handoff, scoped to the in-memory unlocked key. Locking or reloading ends access.
 * Serialize user-written text and photo notes only; binary media never enters model context. */
export interface JournalSelection {
  title: string;
  text: string;
  excerpt: boolean;
}
const selections = new WeakMap<CryptoKey, JournalSelection>();
export function selectJournal(key: CryptoKey, title: string, doc: JSONContent) {
  function visit(node: JSONContent): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "journalImage")
      return [node.attrs?.caption, node.attrs?.note].filter(Boolean).join(" ") + "\n";
    const text = (node.content ?? []).map(visit).join("");
    return node.type === "paragraph" || node.type === "heading" ? text + "\n" : text;
  }
  const full = [title, visit(doc)].join("\n").trim();
  // Keep a bounded excerpt at a word boundary. The chip identifies shortened selections.
  const excerpt = full.length > 6000;
  selections.set(key, { title, text: excerpt ? full.slice(0, 6000).replace(/\s+\S*$/, "") : full, excerpt });
}
export const selectedJournal = (key: CryptoKey) => selections.get(key);
export const clearJournal = (key: CryptoKey) => selections.delete(key);
