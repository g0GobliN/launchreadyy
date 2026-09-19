/**
 * The status page buckets and displays days/months in this fixed-offset zone
 * (no DST, so plain millisecond arithmetic is exact — no need for Intl here).
 */
export const STATUS_TZ_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Tokyo, UTC+9
export const STATUS_TZ_IANA = "Asia/Tokyo";
export const STATUS_TZ_LABEL = "JST";

/** STATUS_TZ calendar fields (month is 0-indexed) for a given real instant. */
export function instantToStatusDate(d: Date): { year: number; month: number; day: number } {
  const shifted = new Date(d.getTime() + STATUS_TZ_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/** Real UTC instant for 00:00 STATUS_TZ on the given STATUS_TZ calendar date (month may roll over). */
export function statusDateToInstant(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month, day) - STATUS_TZ_OFFSET_MS);
}

/** "YYYY-MM-DD" for the given STATUS_TZ calendar date, without going through a Date instant. */
export function statusYmdString(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** "YYYY-MM-DD" for the STATUS_TZ calendar day that a real instant falls in. */
export function statusIsoDate(d: Date): string {
  const { year, month, day } = instantToStatusDate(d);
  return statusYmdString(year, month, day);
}

/** Real UTC instant for 00:00 STATUS_TZ on the calendar day that `d` falls in. */
export function startOfStatusDay(d: Date): Date {
  const { year, month, day } = instantToStatusDate(d);
  return statusDateToInstant(year, month, day);
}

/** 0 (Sunday) – 6 (Saturday) for a STATUS_TZ calendar date — pure calendar math, TZ-independent. */
export function statusDayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}
