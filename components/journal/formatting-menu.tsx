"use client";

import { BubbleMenu, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Bold, Highlighter, Underline } from "lucide-react";
import { useEffect, useState } from "react";

type FormatState = { bold: boolean; underline: boolean; highlight: boolean };

export function FormattingMenu({ editor }: { editor: Editor }) {
  const [active, setActive] = useState<FormatState>({ bold: false, underline: false, highlight: false });

  useEffect(() => {
    const update = () => {
      if (editor.state.selection.empty) return;
      const next = { bold: editor.isActive("bold"), underline: editor.isActive("underline"), highlight: editor.isActive("highlight") };
      setActive((previous) => previous.bold === next.bold && previous.underline === next.underline && previous.highlight === next.highlight ? previous : next);
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => { editor.off("selectionUpdate", update); editor.off("transaction", update); };
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      className="formatting-menu"
      updateDelay={80}
      tippyOptions={{ duration: 120, placement: "top", appendTo: () => document.fullscreenElement || document.body }}
      shouldShow={({ state, view, element, from, to }) =>
        editor.isEditable && state.selection instanceof TextSelection && !state.selection.empty &&
        Boolean(state.doc.textBetween(from, to).length) && (view.hasFocus() || element.contains(document.activeElement))
      }
    >
      <div role="toolbar" aria-label="Text formatting">
        <button type="button" aria-label="Bold" aria-pressed={active.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}><Bold aria-hidden="true" /></button>
        <button type="button" aria-label="Underline" aria-pressed={active.underline} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline aria-hidden="true" /></button>
        <button type="button" aria-label="Highlight" aria-pressed={active.highlight} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter aria-hidden="true" /></button>
      </div>
    </BubbleMenu>
  );
}
