"use client";

import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import type { JournalDraft } from "@/lib/journal-storage";
import type { JSONContent } from "@tiptap/core";
import { getFirebaseServices } from "@/lib/firebase/client";
import { RevisionConflictError, writeJournalRevision } from "@/lib/firebase/repository";
import { decodeText, decryptRecord, encodeText, encryptRecord, type EncryptedRecord } from "@/lib/security/vault";
import { acknowledgeCheckpoint, decryptCheckpoint, listCheckpoints, saveCheckpoint, StaleCheckpointError, type Checkpoint } from "./checkpoints";
import { getEncryptedPhoto, saveEncryptedPhoto, uploadPendingPhotos } from "./media";

interface CloudRecord { revision: number; encrypted: EncryptedRecord }
export interface ListedJournal extends JournalDraft { localCopy?: boolean; conflicted?: boolean }
export interface OpenJournal { draft: JournalDraft | undefined; handle: JournalHandle }
const journalKey = (id: string) => JSON.stringify(["journal", id]);
const localId = (journalId: string, branchId: string) => `${journalId}~${branchId}`;
function parseId(id: string): { journalId: string; branchId?: string } {
  const [journalId, branchId, extra] = id.split("~");
  if (!journalId || extra !== undefined || (branchId !== undefined && !branchId)) throw new Error("Invalid journal identifier.");
  return { journalId, branchId };
}
function parseDraft(bytes: Uint8Array, journalId: string): JournalDraft {
  const draft = JSON.parse(decodeText(bytes)) as JournalDraft;
  if (!draft || draft.id !== journalId || typeof draft.title !== "string" || typeof draft.updatedAt !== "number" || !draft.content || draft.content.type !== "doc") throw new Error("Invalid journal content.");
  return draft;
}
function referencedMedia(node: JSONContent, journalId: string): string[] {
  const found: string[] = [];
  function visit(value: JSONContent) {
    if (value.type === "journalImage") {
      if (value.attrs?.journalId !== journalId || typeof value.attrs?.imageId !== "string") throw new Error("A photo reference is invalid.");
      found.push(value.attrs.imageId);
    }
    value.content?.forEach(visit);
  }
  visit(node);
  return [...new Set(found)];
}
export class JournalWorkspace {
  private cloud = new Map<string, CloudRecord>();
  private unsubscribe?: Unsubscribe;
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readySettled = false;
  private syncing = new Map<string, Promise<void>>();
  private conflicts = new Set<string>();
  private closed = false;
  private statuses = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private readyTimer?: ReturnType<typeof setTimeout>;
  constructor(readonly uid: string, readonly key: CryptoKey) {
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    // The rejection is also observed by consumers of list/open.
    void this.ready.catch(() => {});
  }
  start() {
    this.closed = false;
    this.readyTimer = setTimeout(() => { if (!this.readySettled) { this.readySettled = true; this.resolveReady(); this.notify(); } }, 5000);
    this.unsubscribe = onSnapshot(collection(getFirebaseServices().db, "users", this.uid, "journals"), { includeMetadataChanges: true }, (snapshot) => {
      if (this.closed) return;
      // Memory-only cache may initially be empty while the server is still loading.
      if (snapshot.metadata.fromCache && navigator.onLine && !this.readySettled) return;
      this.cloud = new Map(snapshot.docs.map((doc) => [doc.id, doc.data() as CloudRecord]));
      if (!this.readySettled) { this.readySettled = true; this.resolveReady(); }
      this.notify();
      if (!snapshot.metadata.fromCache) this.scheduleSync();
    }, (error) => {
      if (!this.readySettled) { this.readySettled = true; this.rejectReady(error); }
      this.notify();
    });
    window.addEventListener("online", this.online);
    if (!navigator.onLine && !this.readySettled) { this.readySettled = true; this.resolveReady(); }
  }
  close() { this.closed = true; this.unsubscribe?.(); window.removeEventListener("online", this.online); if (this.timer) clearTimeout(this.timer); if (this.readyTimer) clearTimeout(this.readyTimer); }
  private online = () => { this.conflicts.clear(); this.scheduleSync(); };
  status(handle: JournalHandle) { return this.statuses.get(localId(handle.journalId, handle.branchId)) ?? ""; }
  private setStatus(id: string, value: string) { this.statuses.set(id, value); this.notify(); }
  private notify() { if (!this.closed) window.dispatchEvent(new Event("ovi:journal-change")); }
  private scheduleSync(delay = 1000) { if (this.closed) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.syncPending(), delay); }
  async list(): Promise<ListedJournal[]> {
    await this.ready;
    const branches = await listCheckpoints(this.uid);
    const byJournal = new Map<string, Checkpoint[]>();
    for (const branch of branches) { const group = byJournal.get(branch.journalId) ?? []; group.push(branch); byJournal.set(branch.journalId, group); }
    const ids = new Set([...this.cloud.keys(), ...byJournal.keys()]);
    const result: ListedJournal[] = [];
    for (const id of ids) {
      const cloud = this.cloud.get(id), local = byJournal.get(id) ?? [];
      const pending = local.filter((item) => item.localRevision > item.syncedLocalRevision);
      const differs = pending.length > 1 || pending.some((item) => cloud && item.baseCloudRevision !== cloud.revision) || pending.some((item) => this.conflicts.has(localId(id, item.branchId)));
      if (cloud && (pending.length === 0 || differs)) {
        const bytes = await decryptRecord(this.key, this.uid, journalKey(id), cloud.encrypted);
        try { result.push(parseDraft(bytes, id)); } finally { bytes.fill(0); }
      }
      if (pending.length) {
        for (const branch of pending) {
          const bytes = await decryptCheckpoint(branch, this.key);
          try { result.push({ ...parseDraft(bytes, id), id: localId(id, branch.branchId), localCopy: true, conflicted: Boolean(differs) }); } finally { bytes.fill(0); }
        }
      } else if (!cloud && local.length) {
        const branch = local.sort((a, b) => b.baseCloudRevision - a.baseCloudRevision || b.updatedAt - a.updatedAt)[0];
        const bytes = await decryptCheckpoint(branch, this.key);
        try { result.push({ ...parseDraft(bytes, id), id: localId(id, branch.branchId), localCopy: true }); } finally { bytes.fill(0); }
      }
    }
    return result;
  }
  async hasCloudJournal(id: string): Promise<boolean> { await this.ready; return this.cloud.has(id); }
  async open(id: string, isNew: boolean): Promise<OpenJournal> {
    await this.ready;
    const { journalId, branchId } = parseId(id);
    const branches = await listCheckpoints(this.uid);
    const cloud = this.cloud.get(journalId);
    const related = branches.filter((item) => item.journalId === journalId);
    let branch = branchId ? related.find((item) => item.branchId === branchId) : undefined;
    if (branchId && !branch) throw new Error("Local journal copy not found.");
    if (!branchId && (isNew || !cloud)) {
      const pending = related.filter((item) => item.localRevision > item.syncedLocalRevision);
      if (pending.length === 1 && (!cloud || pending[0].baseCloudRevision === cloud.revision)) branch = pending[0];
      else if (pending.length) throw new Error("Choose the journal version from your library.");
      else if (!cloud && related.length) branch = related.sort((a, b) => b.baseCloudRevision - a.baseCloudRevision || b.updatedAt - a.updatedAt)[0];
    }
    let draft: JournalDraft | undefined;
    if (branch) { const bytes = await decryptCheckpoint(branch, this.key); try { draft = parseDraft(bytes, journalId); } finally { bytes.fill(0); } }
    else if (cloud) { const bytes = await decryptRecord(this.key, this.uid, journalKey(journalId), cloud.encrypted); try { draft = parseDraft(bytes, journalId); } finally { bytes.fill(0); } }
    if (!draft && !isNew) throw new Error("Journal not found.");
    if (branch && branch.localRevision > branch.syncedLocalRevision) this.statuses.set(localId(journalId, branch.branchId), "Saved locally");
    return { draft, handle: new JournalHandle(this, journalId, branch?.branchId ?? crypto.randomUUID(), branch?.localRevision ?? 0, branch?.baseCloudRevision ?? cloud?.revision ?? 0) };
  }
  /** Save a conflicted local branch as a new encrypted journal; keep the source branch intact. */
  async forkLocalCopy(id: string): Promise<string> {
    const source = await this.open(id, false);
    if (!source.draft) throw new Error("Journal copy unavailable.");
    const destination = crypto.randomUUID();
    const mediaIds = new Map<string, string>();
    const copyNode = async (node: JSONContent): Promise<JSONContent> => {
      const result: JSONContent = { ...node };
      if (node.type === "journalImage") {
        const oldId = node.attrs?.imageId;
        if (typeof oldId !== "string" || node.attrs?.journalId !== source.handle.journalId) throw new Error("Invalid photo reference.");
        let newId = mediaIds.get(oldId);
        if (!newId) {
          const photo = await getEncryptedPhoto(this.uid, this.key, source.handle.journalId, oldId);
          if (!photo) throw new Error("Photo unavailable.");
          newId = crypto.randomUUID();
          await saveEncryptedPhoto(this.uid, this.key, destination, newId, photo);
          mediaIds.set(oldId, newId);
        }
        result.attrs = { ...node.attrs, journalId: destination, imageId: newId };
      }
      if (node.content) { result.content = []; for (const child of node.content) result.content.push(await copyNode(child)); }
      return result;
    };
    const content = await copyNode(source.draft.content);
    const target = await this.open(destination, true);
    await target.handle.save({ ...source.draft, id: destination, content, updatedAt: Date.now() });
    return localId(destination, target.handle.branchId);
  }
  async persist(handle: JournalHandle, draft: JournalDraft): Promise<void> {
    const data = encodeText(JSON.stringify({ ...draft, id: handle.journalId }));
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await saveCheckpoint({ uid: this.uid, journalId: handle.journalId, branchId: handle.branchId, localRevision: handle.revision + 1, baseCloudRevision: handle.baseRevision, masterKey: this.key, plaintext: data });
          handle.revision++; this.setStatus(localId(handle.journalId, handle.branchId), navigator.onLine ? "Saved locally" : "Offline — saved locally"); this.scheduleSync(); return;
        } catch (error) {
          if (!(error instanceof StaleCheckpointError)) throw error;
          const current = (await listCheckpoints(this.uid)).find((item) => item.journalId === handle.journalId && item.branchId === handle.branchId);
          if (current && current.localRevision === handle.revision) { handle.baseRevision = current.baseCloudRevision; continue; }
          // Another tab changed this branch. Fork so neither version is overwritten.
          handle.branchId = crypto.randomUUID(); handle.revision = 0;
        }
      }
      throw new Error("Unable to checkpoint this journal.");
    } finally { data.fill(0); }
  }
  async syncPending(): Promise<void> {
    if (this.closed || !navigator.onLine) return;
    try {
      const branches = await listCheckpoints(this.uid);
      const results = await Promise.allSettled(branches.filter((branch) => branch.localRevision > branch.syncedLocalRevision).map((branch) => this.syncBranch(branch)));
      if (results.some((result) => result.status === "rejected")) this.scheduleSync(15000);
    } catch { this.scheduleSync(15000); }
  }
  private async syncBranch(branch: Checkpoint): Promise<void> {
    const id = localId(branch.journalId, branch.branchId);
    if (this.conflicts.has(id)) return;
    if (this.syncing.has(id)) return this.syncing.get(id);
    const work = (async () => {
      const bytes = await decryptCheckpoint(branch, this.key);
      try {
        this.setStatus(id, "Syncing…");
        await uploadPendingPhotos(this.uid, branch.journalId, referencedMedia(parseDraft(bytes, branch.journalId).content, branch.journalId));
        const encrypted = await encryptRecord(this.key, this.uid, journalKey(branch.journalId), bytes);
        if (encrypted.payload.ciphertext.length > 800000) { this.setStatus(id, "Entry too large to sync — saved locally"); return; }
        const revision = await writeJournalRevision(this.uid, branch.journalId, encrypted, branch.baseCloudRevision);
        await acknowledgeCheckpoint(this.uid, branch.journalId, branch.branchId, branch.baseCloudRevision, branch.localRevision, revision);
        this.cloud.set(branch.journalId, { revision, encrypted });
        this.setStatus(id, "Synced");
        // A local checkpoint may have advanced while the request was in flight.
        const latest = (await listCheckpoints(this.uid)).find((item) => item.journalId === branch.journalId && item.branchId === branch.branchId);
        if (latest && latest.localRevision > latest.syncedLocalRevision) { this.setStatus(id, "Saved locally"); this.scheduleSync(); }
      } catch (error) {
        if (error instanceof RevisionConflictError) { this.conflicts.add(id); this.setStatus(id, "Conflict — local copy preserved"); }
        else this.setStatus(id, navigator.onLine ? "Sync pending — saved locally" : "Offline — saved locally");
        throw error;
      } finally { bytes.fill(0); }
    })();
    this.syncing.set(id, work);
    try { await work; } finally { this.syncing.delete(id); }
  }
}
export class JournalHandle {
  constructor(private workspace: JournalWorkspace, readonly journalId: string, public branchId: string, public revision: number, public baseRevision: number) {}
  save(draft: JournalDraft) { return this.workspace.persist(this, draft); }
}
