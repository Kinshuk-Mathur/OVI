"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import { CalendarDays, ImagePlus, Maximize2, MessageCircle, Minimize2, MoreHorizontal } from "lucide-react";
import { JournalImage } from "./journal-image";
import { FormattingMenu } from "./formatting-menu";
import { NodeSelection } from "@tiptap/pm/state";
import { DEFAULT_JOURNAL_TITLE, type JournalDraft } from "@/lib/journal-storage";
import { isMeaningfulDraft } from "@/lib/journal-content";
import { useJournalWorkspace } from "./journal-provider";
import { useVault } from "@/components/auth/vault-provider";
import { saveEncryptedPhoto } from "@/lib/journal/media";
import type { JournalHandle } from "@/lib/journal/workspace";
import { formatEntryDate, localDateKey, parseLocalDate } from "@/lib/journal-dates";

const MAX_PHOTO_SIZE = 12 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
type SaveStatus = "loading" | "empty" | "saved" | "unsaved" | "saving" | "error";

export function JournalPaper({ entryId, isNew, requestedDate }: { entryId: string; isNew: boolean; requestedDate?: string }) {
  const router = useRouter();
  const workspace = useJournalWorkspace();
  const { session } = useVault();
  const handleRef = useRef<JournalHandle | null>(null);
  const [syncStatus, setSyncStatus] = useState("");
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [date, setDate] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const paperRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleValueRef = useRef(DEFAULT_JOURNAL_TITLE);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const entryRef = useRef<Pick<JournalDraft, "id" | "entryDate" | "createdAt"> | null>(null);
  const loadedRef = useRef(false);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const importRef = useRef<(files: File[], position?: number) => void>(() => {});
  const selectionRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const scheduleRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: [StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false, blockquote: false }), Placeholder.configure({ placeholder: "What's on your mind today?" }), Underline, Highlight, JournalImage],
    content: "",
    editable: false,
    immediatelyRender: false,
    enableInputRules: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "journal-writing", role: "textbox", "aria-label": "Journal entry", "aria-multiline": "true" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        importRef.current(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) {
          const selection = view.state.selection;
          if (selection instanceof NodeSelection && selection.node.type.name === "journalImage") {
            const imageId = selection.node.attrs.imageId;
            const bounds = view.dom.getBoundingClientRect();
            const width = Math.min(Number(selection.node.attrs.width) || 360, bounds.width);
            const maxOffset = Math.max(0, 100 * (bounds.width - width) / bounds.width);
            const offset = Math.max(0, Math.min(70, maxOffset, 100 * (event.clientX - bounds.left - width / 2) / bounds.width));
            requestAnimationFrame(() => {
              if (view.isDestroyed) return;
              let position: number | undefined;
              view.state.doc.descendants((node, pos) => {
                if (node.type.name === "journalImage" && node.attrs.imageId === imageId) { position = pos; return false; }
              });
              if (position === undefined) return;
              const node = view.state.doc.nodeAt(position);
              if (node) view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, offset }));
            });
          }
          return false;
        }
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
        importRef.current(files, point?.pos);
        return true;
      },
    },
    onUpdate: () => scheduleRef.current(),
  });
  editorRef.current = editor;

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const currentEditor = editorRef.current;
    if (!loadedRef.current || !currentEditor || currentEditor.isDestroyed || !entryRef.current) return false;
    if (!dirtyRef.current) { try { await saveQueue.current; return !dirtyRef.current; } catch { return false; } }
    const revision = revisionRef.current;
    const draft: JournalDraft = { ...entryRef.current, title: titleValueRef.current, content: currentEditor.getJSON(), updatedAt: Date.now() };
    if (isNew && !handleRef.current?.revision && !isMeaningfulDraft(draft)) { dirtyRef.current = false; return true; }
    if (mountedRef.current) setStatus("saving");
    const write = saveQueue.current.catch(() => {}).then(async () => { if (!handleRef.current) throw new Error("Journal unavailable."); await handleRef.current.save(draft); });
    saveQueue.current = write;
    try {
      await write;
      if (revisionRef.current === revision) {
        dirtyRef.current = false;
        if (mountedRef.current) setStatus("saved");
      }
      return true;
    } catch {
      dirtyRef.current = true;
      if (mountedRef.current) { setStatus("error"); setNotice("Your draft could not be saved on this device. Please check browser storage and try again."); }
      return false;
    }
  }, [isNew]);

  const scheduleSave = useCallback(() => {
    if (!loadedRef.current) return;
    dirtyRef.current = true;
    revisionRef.current += 1;
    setStatus("unsaved");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void saveNow(); }, 250);
  }, [saveNow]);
  scheduleRef.current = scheduleSave;

  useEffect(() => {
    if (!editor) return;
    let active = true;
    workspace.open(entryId, isNew).then(({ draft, handle }) => {
      if (!active) return;
      handleRef.current = handle;
      setSyncStatus(workspace.status(handle));
      if (!draft && !isNew) {
        setStatus("error");
        setNotice("This journal could not be found on this device.");
        return;
      }
      const now = Date.now();
      const entryDate = draft ? draft.entryDate : (requestedDate && parseLocalDate(requestedDate) ? requestedDate : localDateKey(new Date(now)));
      entryRef.current = { id: handle.journalId, entryDate, createdAt: draft ? draft.createdAt : now };
      setDate(entryDate ? formatEntryDate(entryDate, { weekday: "short", month: "short", day: "numeric" }) : "");
      titleValueRef.current = draft?.title ?? DEFAULT_JOURNAL_TITLE;
      if (titleRef.current) titleRef.current.value = titleValueRef.current;
      if (draft?.content) editor.commands.setContent(draft.content, false);
      loadedRef.current = true;
      editor.setEditable(true, false);
      setStatus(draft ? "saved" : "empty");
      if (isNew && window.matchMedia("(pointer: fine)").matches) editor.commands.focus("start");
    }).catch(() => {
      if (!active) return;
      setStatus("error");
      setNotice("This journal could not be opened. If there are different versions, choose one from My Journal. Your local copies are preserved.");
    });
    return () => { active = false; };
  }, [editor, entryId, isNew, requestedDate, workspace]);

  useEffect(() => {
    mountedRef.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !importingRef.current) return;
      if (dirtyRef.current) void saveNow();
      event.preventDefault();
      event.returnValue = "";
    };
    const onPageHide = () => { if (dirtyRef.current) void saveNow(); };
    const onVisibility = () => { if (document.visibilityState === "hidden" && dirtyRef.current) void saveNow(); };
    const flush = (event: Event) => { const detail = (event as CustomEvent<{ promises: Promise<boolean>[] }>).detail; if (!detail?.promises) return; detail.promises.push((async () => { if (importingRef.current) return false; while (dirtyRef.current) if (!await saveNow()) return false; return true; })()); };
    const sync = () => { if (handleRef.current) setSyncStatus(workspace.status(handleRef.current)); };
    window.addEventListener("ovi:flush", flush);
    window.addEventListener("ovi:journal-change", sync);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("popstate", onPageHide);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) void saveNow();
      mountedRef.current = false;
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("popstate", onPageHide);
      window.removeEventListener("ovi:flush", flush);
      window.removeEventListener("ovi:journal-change", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveNow, workspace, entryId]);

  const importPhotos = useCallback(async (files: File[], position?: number) => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !loadedRef.current || !files.length) return;
    const valid = files.filter((file) => PHOTO_TYPES.has(file.type) && file.size <= MAX_PHOTO_SIZE);
    if (valid.length !== files.length) setNotice("Use JPEG, PNG, WebP, or GIF photos up to 12 MB each.");
    else setNotice("");
    if (!valid.length) return;
    importingRef.current = true; setImporting(true);
    try {
      const photos = await Promise.all(valid.map(async (file) => {
        const imageId = crypto.randomUUID();
        if (!handleRef.current) throw new Error("Journal unavailable.");
        await saveEncryptedPhoto(session.user.uid, session.masterKey, handleRef.current.journalId, imageId, file);
        return { type: "journalImage", attrs: { imageId, journalId: handleRef.current.journalId, alt: "Journal photograph", width: 280, offset: 0 } };
      }));
      if (currentEditor.isDestroyed) return;
      const insertAt = Math.min(position ?? currentEditor.state.selection.from, currentEditor.state.doc.content.size);
      currentEditor.chain().focus().insertContentAt(insertAt, [...photos, { type: "paragraph" }]).run();
    } catch {
      setNotice("The photo could not be saved on this device. Please check browser storage and try again.");
    } finally { importingRef.current = false; if (mountedRef.current) setImporting(false); }
  }, [session.user.uid, session.masterKey]);
  importRef.current = (files, position) => { void importPhotos(files, position); };

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    updateFullscreen();
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  async function toggleJournalFullscreen() {
    setMenuOpen(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (paperRef.current?.requestFullscreen) await paperRef.current.requestFullscreen();
      else throw new Error("Fullscreen unavailable");
    } catch {
      setNotice("Fullscreen is unavailable in this browser.");
    }
  }

  function focusWritingArea(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (!loadedRef.current || target.closest('button, input, textarea, a, [contenteditable="true"], [data-node-view-wrapper], .journal-menu')) return;
    if (window.getSelection()?.toString()) return;
    editor?.commands.focus("end");
  }

  async function talkAboutEntry() {
    while (dirtyRef.current) {
      if (!await saveNow()) return;
    }
    router.push(`/?context=journal&id=${encodeURIComponent(entryId)}`);
  }

  return (
    <div className="journal-layout">
      <section ref={paperRef} className="journal-paper" aria-label="Journal page" onClick={focusWritingArea} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && dirtyRef.current) void saveNow(); }}>
        <header className="journal-header">
          <div className="journal-date"><CalendarDays size={19} aria-hidden="true" />{date ? <time>{date}</time> : loadedRef.current ? <div className="journal-date-prompt"><label htmlFor="legacy-entry-date">Set this journal’s original date</label><input ref={dateInputRef} id="legacy-entry-date" type="date" aria-label="Set original journal date" /><button type="button" onClick={() => { const value = dateInputRef.current?.value || ""; if (!parseLocalDate(value) || !entryRef.current) { setNotice("Choose a valid original date for this journal."); return; } entryRef.current = { ...entryRef.current, entryDate: value }; setNotice(""); setDate(formatEntryDate(value, { weekday: "short", month: "short", day: "numeric" })); scheduleSave(); }}>Save date</button></div> : null}</div>
          <div className="journal-header-actions">
            <button type="button" className="journal-icon-button" disabled={status === "loading" || importing || !loadedRef.current} aria-label="Add photos" title="Add photos" onClick={() => { selectionRef.current = editor?.state.selection.from; fileRef.current?.click(); }}><ImagePlus aria-hidden="true" /></button>
            <span className="journal-action-divider" aria-hidden="true" />
            <div ref={menuRef} className="journal-menu-wrap"><button type="button" className="journal-icon-button" aria-label="More journal options" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal aria-hidden="true" /></button>
              {menuOpen && <div className="journal-menu">
                <button type="button" onClick={() => void toggleJournalFullscreen()}>{fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
                <button type="button" onClick={() => { setMenuOpen(false); void saveNow(); }}>Save draft now</button>
              </div>}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" tabIndex={-1} onChange={(event) => { void importPhotos(Array.from(event.target.files ?? []), selectionRef.current); event.target.value = ""; }} />
          <label className="sr-only" htmlFor="journal-title">Journal title</label>
          <div className="journal-title-wrap"><input ref={titleRef} id="journal-title" className="journal-title" defaultValue={DEFAULT_JOURNAL_TITLE} placeholder="Give this entry a title" disabled={status === "loading" || !loadedRef.current} onChange={(event) => { titleValueRef.current = event.target.value; scheduleSave(); }} /></div>
          <div className="journal-save-status" role="status" aria-live="polite">{status === "loading" ? "Opening journal…" : importing ? "Adding photo…" : status === "saving" || status === "unsaved" ? "Saving…" : status === "error" ? "Unable to save" : syncStatus}</div>
        </header>
        {editor && <FormattingMenu editor={editor} />}
        <EditorContent editor={editor} className="journal-editor" onClick={(event) => { if (event.target === event.currentTarget) editor?.commands.focus("end"); }} />
        {notice && <p className="journal-notice" role="alert">{notice}</p>}
      </section>
      <div className="journal-footer"><button type="button" className="talk-action" disabled={status === "loading" || importing || !loadedRef.current} onClick={() => void talkAboutEntry()}><MessageCircle size={22} aria-hidden="true" />Talk to OVI</button></div>
    </div>
  );
}
