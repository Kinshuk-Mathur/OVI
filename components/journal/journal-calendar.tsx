"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { calendarDays, formatEntryDate, localDateKey, monthStart, parseLocalDate, shiftDays, shiftMonth } from "@/lib/journal-dates";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2020, month, 1, 12)));

export function JournalCalendar({ entryDates, selectedDate, onSelect }: { entryDates: Set<string>; selectedDate: string | null; onSelect: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [focusedDate, setFocusedDate] = useState(() => localDateKey(new Date()));
  const [picking, setPicking] = useState(false);
  const [pickerYear, setPickerYear] = useState("");
  const [pickerMonth, setPickerMonth] = useState(0);
  const [pickerError, setPickerError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const today = localDateKey(new Date());

  function close() { setOpen(false); setPicking(false); requestAnimationFrame(() => triggerRef.current?.focus()); }
  function toggle() {
    if (open) { close(); return; }
    const chosen = selectedDate ? parseLocalDate(selectedDate) : new Date();
    if (chosen) { setMonth(monthStart(chosen)); setFocusedDate(localDateKey(chosen)); }
    setOpen(true);
  }
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setMobile(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => dayRefs.current.get(focusedDate)?.focus());
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setPicking(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);

  function moveFocus(date: Date) {
    const key = localDateKey(date);
    setMonth(monthStart(date));
    setFocusedDate(key);
    requestAnimationFrame(() => dayRefs.current.get(key)?.focus());
  }
  function onDayKey(event: React.KeyboardEvent<HTMLButtonElement>, date: Date) {
    let next: Date | undefined;
    if (event.key === "ArrowLeft") next = shiftDays(date, -1);
    else if (event.key === "ArrowRight") next = shiftDays(date, 1);
    else if (event.key === "ArrowUp") next = shiftDays(date, -7);
    else if (event.key === "ArrowDown") next = shiftDays(date, 7);
    else if (event.key === "Home") next = shiftDays(date, -date.getDay());
    else if (event.key === "End") next = shiftDays(date, 6 - date.getDay());
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const target = shiftMonth(date, event.key === "PageUp" ? -1 : 1);
      const last = shiftDays(shiftMonth(target, 1), -1).getDate();
      target.setDate(Math.min(date.getDate(), last));
      next = target;
    }
    if (next) { event.preventDefault(); moveFocus(next); }
  }
  function openPicker() { setPickerYear(String(month.getFullYear())); setPickerMonth(month.getMonth()); setPickerError(""); setPicking(true); }
  function applyPicker(event: React.FormEvent) {
    event.preventDefault();
    const year = Number(pickerYear);
    if (!Number.isInteger(year) || year < 100 || year > 9999) { setPickerError("Enter a year from 100 to 9999."); return; }
    const next = new Date(0); next.setHours(12, 0, 0, 0); next.setFullYear(year, pickerMonth, 1);
    setMonth(next); setFocusedDate(localDateKey(next)); setPicking(false);
    requestAnimationFrame(() => dayRefs.current.get(localDateKey(next))?.focus());
  }
  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !window.matchMedia("(max-width: 700px)").matches) return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), select, input') ?? []);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const days = calendarDays(month);
  return (
    <div className="calendar-anchor" ref={rootRef}>
      <button ref={triggerRef} className="calendar-trigger" type="button" onClick={toggle} aria-label="Open journal calendar" aria-expanded={open} aria-haspopup="dialog"><CalendarDays aria-hidden="true" /></button>
      {open && <>
        <div className="calendar-backdrop" aria-hidden="true" onClick={close} />
        <div className="journal-calendar" ref={dialogRef} role="dialog" aria-label="Journal calendar" aria-modal={mobile || undefined} onKeyDown={trapFocus}>
          <div className="calendar-decoration" aria-hidden="true"><svg viewBox="0 0 80 80"><path d="M72 76C58 48 41 29 13 14M60 57C45 50 38 45 35 38M47 40C51 28 53 21 52 13M31 27C24 28 18 26 13 23" fill="none" stroke="#6b814c" strokeWidth="2"/><g fill="#c84b32"><circle cx="12" cy="13" r="5"/><circle cx="52" cy="12" r="5"/><circle cx="34" cy="37" r="4"/><circle cx="13" cy="23" r="3"/></g></svg></div>
          <button className="calendar-close-mobile" type="button" onClick={close} aria-label="Close calendar"><X size={20} /></button>
          <div className="calendar-heading">
            <button type="button" aria-label="Previous month" onClick={() => { const next = shiftMonth(month, -1); setMonth(next); setFocusedDate(localDateKey(next)); setPicking(false); }}><ChevronLeft /></button>
            <button type="button" className="calendar-month-label" onClick={() => picking ? setPicking(false) : openPicker()} aria-expanded={picking} aria-label={`Choose month and year, currently ${MONTHS[month.getMonth()]} ${month.getFullYear()}`}>{MONTHS[month.getMonth()]} {month.getFullYear()}</button>
            <button type="button" aria-label="Next month" onClick={() => { const next = shiftMonth(month, 1); setMonth(next); setFocusedDate(localDateKey(next)); setPicking(false); }}><ChevronRight /></button>
          </div>
          {picking ? <form className="calendar-picker" onSubmit={applyPicker}>
            <label>Month<select value={pickerMonth} onChange={(event) => setPickerMonth(Number(event.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
            <label>Year<input type="number" min="100" max="9999" value={pickerYear} onChange={(event) => setPickerYear(event.target.value)} /></label>
            {pickerError && <p role="alert">{pickerError}</p>}
            <button type="submit">Go to month</button>
          </form> : <>
            <table className="calendar-grid" aria-label={`${MONTHS[month.getMonth()]} ${month.getFullYear()}`}><thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead><tbody>
              {Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map((day) => {
                const key = localDateKey(day), hasEntry = entryDates.has(key);
                return <td key={key}><button ref={(element) => { if (element) dayRefs.current.set(key, element); else dayRefs.current.delete(key); }} type="button" className={`calendar-day${day.getMonth() !== month.getMonth() ? " is-outside" : ""}${key === today ? " is-today" : ""}${key === selectedDate ? " is-selected" : ""}`} aria-label={`${formatEntryDate(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${hasEntry ? ", has journal entry" : ""}${key === today ? ", today" : ""}`} aria-pressed={key === selectedDate} tabIndex={key === focusedDate ? 0 : -1} onKeyDown={(event) => onDayKey(event, day)} onClick={() => { onSelect(key); close(); }}><span>{day.getDate()}</span>{hasEntry && <span className="calendar-dot" aria-hidden="true" />}</button></td>;
              })}</tr>)}
            </tbody></table>
            <div className="calendar-legend"><span className="calendar-dot" /> Has journal entry</div>
          </>}
          <div className="calendar-hills" aria-hidden="true"><svg viewBox="0 0 440 70" preserveAspectRatio="none"><path fill="#ecd6a8" d="M0 70Q45 47 90 55T180 39T270 48T350 28T440 45V70Z"/><path fill="#bbc292" opacity=".55" d="M0 70Q55 63 102 52T202 57T300 43T385 37T440 22V70Z"/></svg></div>
        </div>
      </>}
    </div>
  );
}
