// Best-effort heuristic parser that turns raw OCR text from a screenshot of
// a meeting invite (Outlook, Teams, Google Calendar, Zoom, a calendar app —
// whatever the person screenshots) into a draft meeting. There's no way to
// parse every possible invite layout perfectly with regex alone, so this
// aims to get the common cases right and leave the rest null rather than
// guess — screenshotImport.ts always shows the result back to the person
// before treating it as final, so a missed field just means they fill it in
// by hand instead of the whole import being wrong.

export interface ParsedMeeting {
  title: string | null;
  date: Date | null; // midnight, local time, on the detected day
  startTime: Date | null; // full date+time
  endTime: Date | null; // full date+time
  link: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MEETING_LINK_RE =
  /https?:\/\/[^\s)>\]]*(teams\.microsoft\.com|meet\.google\.com|zoom\.us|webex\.com|meetings\.teams\.microsoft\.com)[^\s)>\]]*/i;

// "29 September 2026" / "29 Sep 2026"
const DATE_DAY_MONTH_YEAR_RE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/;
// "September 29, 2026" / "Sep 29, 2026"
const DATE_MONTH_DAY_YEAR_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/;
// Numeric fallback "29/09/2026" or "9/29/2026" — day/month order is
// ambiguous, so this is only used if nothing more explicit is found, and
// assumes day-first (DD/MM/YYYY), matching Indian date convention.
const DATE_NUMERIC_RE = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/;

// "10:00 AM - 10:30 AM", "10:00 – 10:30", "2:00 PM to 2:30 PM"
const TIME_RANGE_RE =
  /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\b/;
// A single time, used as a fallback if no range is found
const TIME_SINGLE_RE = /\b(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)\b/;

const TODAY_RE = /\btoday\b/i;
const TOMORROW_RE = /\btomorrow\b/i;

const SUBJECT_LINE_RE = /^\s*(subject|title|event|meeting)\s*[:\-]\s*(.+)$/i;

// Lines that are clearly metadata, not a title — skip these when guessing
// the title from the first substantial line.
const SKIP_LINE_RE =
  /^\s*(when|where|who|organizer|invitee|location|time zone|timezone|calendar|recurrence|join|click here|http|www\.)/i;

export function parseMeetingText(rawText: string): ParsedMeeting {
  const text = rawText.replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const link = MEETING_LINK_RE.exec(text)?.[0] ?? null;
  const date = extractDate(text);
  const { start, end } = extractTimeRange(text);
  const title = extractTitle(lines);

  const startTime = date && start ? combineDateAndTime(date, start) : null;
  const endTime = date && end ? combineDateAndTime(date, end) : null;

  return { title, date, startTime, endTime, link };
}

function extractDate(text: string): Date | null {
  if (TODAY_RE.test(text)) return startOfDay(new Date());
  if (TOMORROW_RE.test(text)) {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() + 1);
    return d;
  }

  let m = DATE_DAY_MONTH_YEAR_RE.exec(text);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) return new Date(Number(m[3]), month, Number(m[1]));
  }

  m = DATE_MONTH_DAY_YEAR_RE.exec(text);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) return new Date(Number(m[3]), month, Number(m[2]));
  }

  m = DATE_NUMERIC_RE.exec(text);
  if (m) {
    // Assumes DD/MM/YYYY (day first) — flip here if this ever needs to
    // support a US-first locale.
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) return new Date(year, month, day);
  }

  return null;
}

function extractTimeRange(text: string): { start: { h: number; m: number } | null; end: { h: number; m: number } | null } {
  const range = TIME_RANGE_RE.exec(text);
  if (range) {
    const [, sh, sm, sap, eh, em, eap] = range;
    // If only the end time carries AM/PM, apply it to the start time too —
    // e.g. "10 - 10:30 PM" both means PM, a very common shorthand.
    const startAp = sap || eap;
    return {
      start: { h: to24Hour(Number(sh), startAp), m: Number(sm) },
      end: { h: to24Hour(Number(eh), eap), m: Number(em) },
    };
  }

  const single = TIME_SINGLE_RE.exec(text);
  if (single) {
    const [, h, m, ap] = single;
    return { start: { h: to24Hour(Number(h), ap), m: Number(m) }, end: null };
  }

  return { start: null, end: null };
}

function to24Hour(hour: number, ampm?: string): number {
  if (!ampm) return hour;
  const isPm = ampm.toLowerCase() === 'pm';
  if (isPm && hour < 12) return hour + 12;
  if (!isPm && hour === 12) return 0; // 12 AM = midnight
  return hour;
}

function extractTitle(lines: string[]): string | null {
  for (const line of lines) {
    const subjectMatch = SUBJECT_LINE_RE.exec(line);
    if (subjectMatch) return subjectMatch[2].trim();
  }

  for (const line of lines) {
    if (line.length < 3 || line.length > 120) continue;
    if (SKIP_LINE_RE.test(line)) continue;
    if (TIME_RANGE_RE.test(line) || TIME_SINGLE_RE.test(line)) continue;
    if (DATE_DAY_MONTH_YEAR_RE.test(line) || DATE_MONTH_DAY_YEAR_RE.test(line)) continue;
    if (/^https?:\/\//i.test(line)) continue;
    if (/^\S+@\S+\.\S+$/.test(line)) continue; // a bare email address
    return line;
  }

  return null;
}

function combineDateAndTime(date: Date, time: { h: number; m: number }): Date {
  const d = new Date(date);
  d.setHours(time.h, time.m, 0, 0);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
