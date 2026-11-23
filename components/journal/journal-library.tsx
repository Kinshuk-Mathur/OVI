"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowerMark } from "@/components/ovi-logo";
import { formatEntryDate, localDateKey, parseLocalDate } from "@/lib/journal-dates";
import { isMeaningfulDraft } from "@/lib/journal-content";
import { DEFAULT_JOURNAL_TITLE, listJournalDrafts } from "@/lib/journal-storage";
import { migrateLegacyJournals } from "@/lib/journal/migrate";
import { useVault } from "@/components/auth/vault-provider";
import type { ListedJournal } from "@/lib/journal/workspace";
import { useJournalWorkspace } from "./journal-provider";
import { JournalCalendar } from "./journal-calendar";

interface YearGroup { year: number; months: { month: number; entries: ListedJournal[] }[] }
function groupByDate(entries: ListedJournal[]): YearGroup[] {
  const years = new Map<number, Map<number, ListedJournal[]>>();
  for (const entry of entries) {
    const date = entry.entryDate ? parseLocalDate(entry.entryDate) : null;
    if (!date) continue;
    const year = date.getFullYear(), month = date.getMonth();
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year)!;
    if (!months.has(month)) months.set(month, []);
    months.get(month)!.push(entry);
  }
  return Array.from(years, ([year, months]) => ({ year, months: Array.from(months, ([month, entries]) => ({ month, entries })).sort((a, b) => b.month - a.month) })).sort((a, b) => b.year - a.year);
}

function preview(entry: ListedJournal): string {
  const parts: string[] = [];
  let length = 0;
  function visit(node: typeof entry.content) {
    if (length >= 180) return;
    if (node.text) { parts.push(node.text); length += node.text.length; }
    node.content?.forEach(visit);
  }
  visit(entry.content);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 180);
}
function EntryCard({ entry }: { entry: ListedJournal }) {
  const date = entry.entryDate ? parseLocalDate(entry.entryDate) : null;
  const textPreview = preview(entry);
  const workspace = useJournalWorkspace();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function keepCopy() {
    if (working) return;
    setWorking(true); setError("");
    try { const id = await workspace.forkLocalCopy(entry.id); router.push(`/journal/${encodeURIComponent(id)}`); }
    catch { setError("The copy could not be created. Your original local version is still here."); setWorking(false); }
  }
  return <div><Link href={`/journal/${encodeURIComponent(entry.id)}`} className="entry-card">
    <span className="entry-date-badge" aria-hidden="true">{date ? <><span>{formatEntryDate(entry.entryDate!, { month: "short" })}</span><strong>{String(date.getDate()).padStart(2, "0")}</strong></> : <><span>Date</span><strong>—</strong></>}</span>
    <span className="entry-card-divider" aria-hidden="true" />
    <span className="entry-card-copy"><strong>{entry.title.trim() || DEFAULT_JOURNAL_TITLE}</strong>{textPreview && <small className="entry-preview">{textPreview}</small>}{entry.localCopy && <small>{entry.conflicted ? "Conflict — local copy preserved" : "Local copy"}</small>}</span>
    <ChevronRight className="entry-chevron" aria-hidden="true" />
  </Link>{entry.conflicted && <div className="conflict-action"><button type="button" disabled={working} onClick={() => void keepCopy()}>{working ? "Creating copy…" : "Save this version as a new journal"}</button>{error && <span role="alert">{error}</span>}</div>}</div>;
}

export function JournalLibrary() {
  const router = useRouter();
  const workspace = useJournalWorkspace();
  const { session } = useVault();
  const [legacyCount, setLegacyCount] = useState(0);
  const [confirmImport, setConfirmImport] = useState(false);
  const [importingLegacy, setImportingLegacy] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [entries, setEntries] = useState<ListedJournal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const drafts = await workspace.list();
      setEntries(drafts.filter(isMeaningfulDraft).sort((a, b) => (b.entryDate || "").localeCompare(a.entryDate || "") || (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id)));
      setError("");
    } catch { setError("Your journals could not be opened on this device. Check browser storage and try again."); }
    finally { setLoading(false); }
  }, [workspace]);
  useEffect(() => {
    void load();
    window.addEventListener("ovi:journal-change", load);
    window.addEventListener("focus", load);
    return () => { window.removeEventListener("ovi:journal-change", load); window.removeEventListener("focus", load); };
  }, [load]);

  useEffect(() => { let active = true; void listJournalDrafts().then((drafts) => { if (active) setLegacyCount(drafts.filter(isMeaningfulDraft).length); }).catch(() => {}); return () => { active = false; }; }, []);

  useEffect(() => {
    const restoreFilter = () => {
      const date = new URLSearchParams(window.location.search).get("date");
      setSelectedDate(date && parseLocalDate(date) ? date : null);
    };
    restoreFilter();
    window.addEventListener("popstate", restoreFilter);
    return () => window.removeEventListener("popstate", restoreFilter);
  }, []);

  function selectDate(date: string | null) {
    setSelectedDate(date);
    const url = new URL(window.location.href);
    if (date) url.searchParams.set("date", date); else url.searchParams.delete("date");
    window.history.replaceState(window.history.state, "", url);
  }

  const entryDates = useMemo(() => new Set(entries.flatMap((entry) => entry.entryDate ? [entry.entryDate] : [])), [entries]);
  const displayed = selectedDate ? entries.filter((entry) => entry.entryDate === selectedDate) : entries;
  const groups = useMemo(() => groupByDate(displayed), [displayed]);
  const undated = displayed.filter((entry) => !entry.entryDate || !parseLocalDate(entry.entryDate));

  async function createJournal(date?: string) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    const id = crypto.randomUUID();
    const now = Date.now();
    const day = date && parseLocalDate(date) ? date : localDateKey(new Date(now));
    router.push(`/journal/${id}?new=1&date=${day}`);
  }

  return <div className="library-layout">
    <header className="library-header">
      <div className="library-title"><h1>My Journal</h1></div>
      <div className="library-actions"><JournalCalendar entryDates={entryDates} selectedDate={selectedDate} onSelect={selectDate} /><button className="new-journal-button" type="button" disabled={creating} onClick={() => void createJournal()}><Plus size={21} aria-hidden="true" />New Journal</button></div>
    </header>
    {legacyCount > 0 && <div className="legacy-import"><span>{legacyCount} earlier local {legacyCount === 1 ? "journal is" : "journals are"} available on this device.</span> {!confirmImport ? <button type="button" onClick={() => setConfirmImport(true)}>Import earlier journals</button> : <><span>Encrypt and import into {session.user.email || "this Google account"}? Originals will remain on this device.</span> <button type="button" disabled={importingLegacy} onClick={() => { setImportingLegacy(true); void migrateLegacyJournals(workspace).then((result) => { setImportNotice(`${result.imported} imported, ${result.skipped} already present, ${result.pending} awaiting cloud verification, ${result.failed} could not be imported. Originals remain on this device.`); void load(); }).catch(() => setImportNotice("Import could not be completed. Originals remain on this device." )).finally(() => { setImportingLegacy(false); setConfirmImport(false); }); }}>{importingLegacy ? "Importing…" : "Confirm import"}</button> <button type="button" disabled={importingLegacy} onClick={() => setConfirmImport(false)}>Cancel</button></>}{importNotice && <p role="status">{importNotice}</p>}</div>}
    <div className={`library-entries${!loading && !error && !selectedDate && entries.length === 0 ? " is-empty" : ""}`}>
      {selectedDate && <div className="library-filter"><h2>Journals from {formatEntryDate(selectedDate, { month: "long", day: "numeric", year: "numeric" })}</h2><button type="button" onClick={() => selectDate(null)}>Show all journals</button></div>}
      {loading ? <p className="library-message" role="status">Opening your journals…</p> : error ? <div className="library-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div> : selectedDate && !displayed.length ? <div className="library-empty filtered-empty"><FlowerMark className="empty-flower" /><h2>No journal for this day yet.</h2><button type="button" className="new-journal-button" disabled={creating} onClick={() => void createJournal(selectedDate)}><Plus size={19} aria-hidden="true" />Write about this day</button></div> : !entries.length ? <div className="library-empty"><FlowerMark className="empty-flower" /><h2>Your story begins here.</h2><p>Every day holds something worth remembering.</p><button type="button" className="new-journal-button" disabled={creating} onClick={() => void createJournal()}><Plus size={19} aria-hidden="true" />Write your first journal</button></div> : <>
        {groups.map(({ year, months }) => <section key={year} className="library-year"><div className="year-heading"><h2>{year}</h2><span /></div>{months.map(({ month, entries: monthEntries }) => <section key={month} className="library-month"><h3><CalendarDays size={19} aria-hidden="true" />{new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(year, month, 1, 12))}</h3><div className="entry-list">{monthEntries.map((entry) => <EntryCard key={entry.id} entry={entry} />)}</div></section>)}</section>)}
        {undated.length > 0 && <section className="library-year"><div className="year-heading"><h2>Date needed</h2><span /></div><p className="legacy-date-explanation">These earlier journals were saved without their original date. Open one to set it.</p><div className="entry-list">{undated.map((entry) => <EntryCard key={entry.id} entry={entry} />)}</div></section>}
      </>}
    </div>
  </div>;
}
