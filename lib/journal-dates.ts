/** Journal dates are local calendar dates, stored as YYYY-MM-DD, not UTC timestamps. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseLocalDate(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function makeLocalDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}
export function monthStart(date: Date): Date { return makeLocalDate(date.getFullYear(), date.getMonth(), 1); }
export function shiftMonth(date: Date, amount: number): Date { return makeLocalDate(date.getFullYear(), date.getMonth() + amount, 1); }
export function shiftDays(date: Date, amount: number): Date { return makeLocalDate(date.getFullYear(), date.getMonth(), date.getDate() + amount); }
export function calendarDays(month: Date): Date[] {
  const first = monthStart(month);
  const start = shiftDays(first, -first.getDay());
  const lastDay = shiftDays(shiftMonth(first, 1), -1).getDate();
  const cells = Math.ceil((first.getDay() + lastDay) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => shiftDays(start, index));
}
export function formatEntryDate(key: string, options: Intl.DateTimeFormatOptions): string {
  const date = parseLocalDate(key);
  return date ? new Intl.DateTimeFormat(undefined, options).format(date) : key;
}
