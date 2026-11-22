import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDays, localDateKey, parseLocalDate, shiftDays, shiftMonth } from '../lib/journal-dates.ts';

test('journal dates round-trip as local dates and reject invalid leap days', () => {
  assert.equal(localDateKey(parseLocalDate('2024-02-29')), '2024-02-29');
  assert.equal(parseLocalDate('2023-02-29'), null);
  assert.equal(parseLocalDate('2024-04-31'), null);
  assert.equal(localDateKey(shiftDays(parseLocalDate('2024-02-29'), 1)), '2024-03-01');
});

test('calendar grids and month navigation respect year boundaries', () => {
  assert.equal(localDateKey(shiftMonth(parseLocalDate('2026-12-15'), 1)), '2027-01-01');
  assert.equal(localDateKey(shiftMonth(parseLocalDate('2026-01-15'), -1)), '2025-12-01');
  const days = calendarDays(parseLocalDate('2024-02-01'));
  assert.equal(days.length, 35);
  assert.equal(localDateKey(days[0]), '2024-01-28');
  assert.ok(days.some((date) => localDateKey(date) === '2024-02-29'));
  assert.equal(localDateKey(days.at(-1)), '2024-03-02');
});
