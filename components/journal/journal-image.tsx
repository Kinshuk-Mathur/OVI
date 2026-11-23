"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, Minus, Plus, Trash2 } from "lucide-react";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";
import { getEncryptedPhoto } from "@/lib/journal/media";
import { useVault } from "@/components/auth/vault-provider";

function JournalImageView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const { session } = useVault();
  const journalId = node.attrs.journalId as string;
  const [source, setSource] = useState<string>();
  const [missing, setMissing] = useState(false);
  const [active, setActive] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imageId = node.attrs.imageId as string;
  const width = Number(node.attrs.width) || 280;
  const offset = Math.max(0, Math.min(70, Number(node.attrs.offset) || 0));

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setMissing(false);
    if (!journalId) { setMissing(true); return; }
    getEncryptedPhoto(session.user.uid, session.masterKey, journalId, imageId).then((photo) => {
      if (!active) return;
      if (!photo) { setMissing(true); return; }
      objectUrl = URL.createObjectURL(photo);
      setSource(objectUrl);
    }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageId, journalId, session.user.uid, session.masterKey]);

  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as globalThis.Node)) setActive(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);

  function movePhoto(direction: "up" | "down") {
    const position = getPos();
    if (typeof position !== "number") return;
    const { state, view } = editor;
    const before = state.doc.resolve(position);
    const after = state.doc.resolve(position + node.nodeSize);
    const neighbor = direction === "up" ? before.nodeBefore : after.nodeAfter;
    if (!neighbor) return;
    const start = direction === "up" ? position - neighbor.nodeSize : position;
    const end = direction === "up" ? position + node.nodeSize : position + node.nodeSize + neighbor.nodeSize;
    const replacement = direction === "up" ? [node, neighbor] : [neighbor, node];
    const transaction = state.tr.replaceWith(start, end, Fragment.fromArray(replacement));
    const newPosition = direction === "up" ? start : start + neighbor.nodeSize;
    transaction.setSelection(NodeSelection.create(transaction.doc, newPosition));
    view.dispatch(transaction.scrollIntoView());
    editor.commands.focus();
  }

  return (
    <NodeViewWrapper ref={wrapperRef} className={`journal-photo-wrap${active ? " is-selected" : ""}`} tabIndex={0} role="group" aria-label="Journal photo" onPointerDown={() => setActive(true)} onFocus={() => setActive(true)} onKeyDown={(event: React.KeyboardEvent) => { if (event.key === "Escape") { setActive(false); editor.commands.focus(); } }}>
      <figure className="journal-photo" data-drag-handle title="Drag to move photo">
        <input
          className="photo-tape"
          aria-label="Photo tape note"
          placeholder="Add a note"
          maxLength={18}
          value={node.attrs.note || ""}
          contentEditable={false}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => updateAttributes({ note: event.target.value })}
        />
        {source ? <img src={source} alt={node.attrs.alt || "Journal photograph"} draggable={false} /> : <div className="photo-loading">{missing ? "Photo unavailable on this device" : "Loading photo…"}</div>}
      </figure>
      {active && <div className="photo-controls" contentEditable={false} role="group" aria-label="Photo controls">
        <span className="photo-drag" data-drag-handle title="Drag to move photo" aria-label="Drag to move photo"><GripVertical size={16} /></span>
        <button type="button" onClick={() => updateAttributes({ offset: Math.max(0, offset - 10) })} disabled={offset <= 0} aria-label="Move photo left"><ArrowLeft size={16} /></button>
        <button type="button" onClick={() => updateAttributes({ offset: Math.min(70, offset + 10) })} disabled={offset >= 70} aria-label="Move photo right"><ArrowRight size={16} /></button>
        <button type="button" onClick={() => movePhoto("up")} aria-label="Move photo up"><ArrowUp size={16} /></button>
        <button type="button" onClick={() => movePhoto("down")} aria-label="Move photo down"><ArrowDown size={16} /></button>
        <button type="button" onClick={() => updateAttributes({ width: Math.max(160, width - 80) })} disabled={width <= 160} aria-label="Make photo smaller"><Minus size={16} /></button>
        <button type="button" onClick={() => updateAttributes({ width: Math.min(720, width + 80) })} disabled={width >= 720} aria-label="Make photo larger"><Plus size={16} /></button>
        <button type="button" onClick={deleteNode} aria-label="Remove photo"><Trash2 size={16} /></button>
      </div>}
    </NodeViewWrapper>
  );
}

export const JournalImage = Node.create({
  name: "journalImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { imageId: { default: null }, journalId: { default: null }, alt: { default: "Journal photograph" }, width: { default: 360 }, offset: { default: 0 }, note: { default: "" } };
  },
  parseHTML() { return [{ tag: "figure[data-journal-image]" }]; },
  renderHTML({ HTMLAttributes }) { return ["figure", mergeAttributes(HTMLAttributes, { "data-journal-image": "" })]; },
  addNodeView() {
    return ReactNodeViewRenderer(JournalImageView, {
      attrs: ({ node }) => ({
        style: `--photo-width: ${Math.max(160, Math.min(720, Number(node.attrs.width) || 360))}px; --photo-offset: ${Math.max(0, Math.min(70, Number(node.attrs.offset) || 0))}%;`,
        "data-controls-align": Number(node.attrs.offset) > 35 ? "right" : "left",
      }),
    });
  },
});
