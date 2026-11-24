import { BookOpen, X } from "lucide-react";
import type { JournalSelection } from "@/lib/conversations/journal-selection";
/** A removable, one-turn disclosure. The selected draft comes from the editor's explicit action. */
export function JournalContext({ journal, remove }: { journal: JournalSelection; remove: () => void }) {
  return (
    <div className="selected-journal">
      <BookOpen size={16} />
      <span>
        {journal.excerpt ? "Journal excerpt" : "Selected journal"} · {journal.title}
      </span>
      <button aria-label="Remove journal context" onClick={remove}>
        <X size={15} />
      </button>
    </div>
  );
}
