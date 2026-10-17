// Best-effort heuristic parser that turns raw OCR text from a screenshot of
// a meeting invite (Outlook, Teams, Google Calendar, Zoom, a calendar app -
// whatever the person screenshots) into a draft meeting. There's no way to
// parse every possible invite layout perfectly with regex alone, so this
// aims to get the common cases right and leave the rest null rather than
// guess - screenshotImport.ts always shows the result back to the person
// before treating it as final, so a missed field just means they fill it in
// by hand instead of the whole import being wrong.
import type { RepeatOption } from '../types';

export interface ParsedMeeting {
  title: string | null;
  date: Date | null; // midnight, local time, on the detected day
  startTime: Date | null; // full date+time
  endTime: Date | null; // full date+time
  link: string | null;
  /** Who's organizing it, e.g. from an Outlook/Teams invite's "Organizer"
   * line. Free text, same field AddMeetingScreen's Organizer box fills. */
  organizer: string | null;
  /** Whatever agenda/description text followed an "Agenda"/"Description"/
   * "Notes" label in the screenshot, a few lines at most - not the whole
   * OCR dump, just the block that looked like it belonged there. */
  notes: string | null;
  /** The dial-in-style "Meeting ID" some Zoom/Teams invites show next to the
   * join link (e.g. "123 4567 8901") - kept as whatever digit/space/dash
   * grouping the invite itself used, not normalized. */
  joinMeetingId: string | null;
  /** The passcode/password shown alongside the Meeting ID above. */
  joinPasscode: string | null;
  /** How often it repeats, guessed from a phrase like "Occurs every
   * Monday" or "Recurring meeting" - null when no such phrase was found,
   * which the caller should treat as "don't touch the Repeat setting"
   * rather than "does not repeat". */
  repeat: RepeatOption | null;
  /** Only set when `repeat` is 'recurring' and specific weekday(s) were
   * actually named (e.g. "every Monday") - JS Date#getDay() convention
   * (0 = Sunday). */
  daysOfWeek?: number[];
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const MEETING_LINK_RE =
  /https?:\/\/[^\s)>\]]*(teams\.microsoft\.com|meet\.google\.com|zoom\.us|webex\.com|meetings\.teams\.microsoft\.com)[^\s)>\]]*/i;

// "Meeting ID: 123 4567 8901" (Zoom/Teams) - kept as whatever digit/space/
// dash grouping the invite itself used (not normalized to plain digits),
// since that's exactly how the person would read it back off their own
// screen to type into Zoom/Teams.
const MEETING_ID_RE = /\bmeeting\s*id\s*[:\-]?\s*(\d[\d \-]{4,24}\d)\b/i;
// "Passcode: 445566" / "Pass code: Ab12Cd" / "Password: 445566"
const PASSCODE_RE = /\b(?:passcode|pass\s*code|password)\s*[:\-]?\s*([A-Za-z0-9]{4,12})\b/i;

// A space-free run of URL-safe characters - used to recognize a screenshot
// line that's purely a continuation of a link wrapped onto it, not a new
// piece of metadata of its own (which always either has a space, like
// "Meeting ID: 123 456", or is blank).
const URL_CONTINUATION_RE = /^[A-Za-z0-9%._~:/?#[\]@!$&'()*+,;=-]+$/;

// "29 September 2026" / "29 Sep 2026"
const DATE_DAY_MONTH_YEAR_RE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/;
// "September 29, 2026" / "Sep 29, 2026"
const DATE_MONTH_DAY_YEAR_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/;
// Numeric fallback "29/09/2026" or "9/29/2026" - day/month order is
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

// Same-line "Organizer: Jane Doe" / "Organiser: Jane Doe" (both US and
// British spelling - Outlook and Teams screenshots use either depending on
// locale, and the rest of the app's own copy says "Organiser").
const ORGANIZER_LABEL_LINE_RE = /^\s*organi[sz]er\s*[:\-]\s*(.+)$/i;
// "Organized by Jane Doe" / "Organised by: Jane Doe" - the attribution
// phrase rather than a label, so it's matched anywhere in the line.
const ORGANIZED_BY_RE = /organi[sz]ed\s+by\s*[:\-]?\s*(.+)$/i;
// Teams/Outlook often render "Organizer"/"Organiser" as its own label
// line, with the name on the line right after it rather than on the same
// line.
const ORGANIZER_LABEL_ONLY_RE = /^\s*organi[sz]er\s*$/i;

// A label line that introduces an agenda/description/notes block -
// optionally carrying the first bit of the text itself after the colon.
const NOTES_LABEL_RE = /^\s*(agenda|description|notes)\s*[:\-]?\s*(.*)$/i;
// How many lines of agenda/description text to pull in after the label -
// a short snippet, not the rest of the screenshot.
const MAX_NOTES_LINES = 8;

// Lines that are clearly metadata, not a title or agenda text - skip these
// when guessing the title from the first substantial line, and treat them
// as the end of an agenda/description block.
const SKIP_LINE_RE =
  /^\s*(when|where|who|organi[sz]\w*|invitee|location|time zone|timezone|calendar|recurrence|repeats?|occurs|join|click here|http|www\.|meeting\s*id|pass\s*code|password)/i;

// Recurrence/frequency phrases - shared between this screenshot parser and
// AddMeetingScreen's quick-add/voice parser (parseQuickAdd), so "Occurs
// every Monday" on a screenshot and "every Monday" spoken aloud are
// understood the same way.
const RECURRENCE_NONE_RE = /\b(does not repeat|no repeat|one[- ]time|non[- ]recurring)\b/i;
const RECURRENCE_WEEKDAYS_RE = /\bweekdays\b|\bmon(?:day)?\s*(?:-|to)\s*fri(?:day)?\b/i;
const RECURRENCE_WEEKENDS_RE = /\bweekends\b/i;
const RECURRENCE_BIWEEKLY_RE = /\bbi[- ]?weekly\b|\bevery (?:other|two) weeks?\b|\bfortnightly\b/i;
const RECURRENCE_MONTHLY_RE = /\bmonthly\b|\bevery month\b/i;
const RECURRENCE_DAILY_RE = /\bdaily\b|\bevery day\b/i;
const RECURRENCE_EVERY_WEEKDAY_RE =
  /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
const RECURRENCE_GENERIC_RE = /\bweekly\b|\brecurring\b|\brepeats\b|\boccurs\b/i;

/** Matches any recognized recurrence phrase, for stripping it out of free
 * text once it's been classified (e.g. so "standup every Monday 9am"
 * doesn't leave "every Monday" sitting in the parsed title). Kept in sync
 * with the individual RECURRENCE_*_RE patterns above by hand - there's no
 * single regex that covers all of them cleanly. */
export const RECURRENCE_PHRASE_RE =
  /\b(does not repeat|no repeat|one[- ]time|non[- ]recurring|weekdays|mon(?:day)?\s*(?:-|to)\s*fri(?:day)?|weekends|bi[- ]?weekly|every (?:other|two) weeks?|fortnightly|monthly|every month|daily|every day|every (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|weekly|recurring|repeats|occurs)\b/gi;

export interface RecurrenceGuess {
  repeat: RepeatOption;
  daysOfWeek?: number[];
}

/** Looks for a recurrence/frequency phrase in free text - "Occurs every
 * Monday", "Recurring meeting", "weekdays", "daily", "does not repeat"...
 * Returns null when nothing recognizable is found, which callers should
 * treat as "leave whatever Repeat setting is already selected alone"
 * rather than as "no repeat" - a bad guess here is worse than no guess,
 * same philosophy as the rest of this file. */
export function detectRecurrence(text: string): RecurrenceGuess | null {
  if (RECURRENCE_NONE_RE.test(text)) return { repeat: 'none' };
  if (RECURRENCE_WEEKDAYS_RE.test(text)) return { repeat: 'weekdays' };
  if (RECURRENCE_WEEKENDS_RE.test(text)) return { repeat: 'weekends' };
  if (RECURRENCE_BIWEEKLY_RE.test(text)) return { repeat: 'biweekly' };
  if (RECURRENCE_MONTHLY_RE.test(text)) return { repeat: 'monthly' };
  if (RECURRENCE_DAILY_RE.test(text)) return { repeat: 'recurring', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] };

  const weekdayHits = Array.from(text.matchAll(RECURRENCE_EVERY_WEEKDAY_RE)).map((m) =>
    WEEKDAY_NAMES.indexOf(m[1].toLowerCase())
  );
  if (weekdayHits.length) return { repeat: 'recurring', daysOfWeek: Array.from(new Set(weekdayHits)).sort() };

  if (RECURRENCE_GENERIC_RE.test(text)) return { repeat: 'recurring' };

  return null;
}

/** `fallbackDate` is only passed by parseMeetingTextMulti(): an agenda/day
 * view typically shows its date ONCE for the whole screenshot (a header
 * above the list) rather than repeating it on every entry, so a per-entry
 * block that has a time but no date of its own still gets one instead of
 * silently dropping its startTime/endTime. A single-invite import (the only
 * other caller) never passes this - that invite's own "When:" line, if any,
 * always wins regardless. */
export function parseMeetingText(rawText: string, fallbackDate: Date | null = null): ParsedMeeting {
  const text = rawText.replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Link detection runs against a "dewrapped" copy, not `text` itself - a
  // long Teams/Zoom URL often gets visually wrapped onto a second line by
  // the screenshot's own layout, with no space of its own at the break, and
  // the plain regex below would otherwise stop at that line break and only
  // capture the first half of it (see dewrapUrls() for how this is joined
  // back). Title/date/time/organizer/notes still scan the original
  // line-by-line text, since none of those are ever meant to span a wrap.
  const link = MEETING_LINK_RE.exec(dewrapUrls(text))?.[0] ?? null;
  const date = extractDate(text) ?? fallbackDate;
  const { start, end } = extractTimeRange(text);
  const title = extractTitle(lines);
  const organizer = extractOrganizer(lines);
  const joinMeetingId = MEETING_ID_RE.exec(text)?.[1]?.trim() ?? null;
  const joinPasscode = PASSCODE_RE.exec(text)?.[1]?.trim() ?? null;
  const { notes, range: notesRange } = extractNotes(lines);
  // Recurrence is detected everywhere EXCEPT inside the agenda/notes block -
  // free-form agenda prose routinely contains words like "daily" or
  // "weekly" ("Daily team check-in") that say nothing about how often the
  // calendar event itself repeats, and scanning it would read those as a
  // recurrence phrase. Short metadata-style lines elsewhere (the title, an
  // explicit "Occurs every Monday") are exactly what this is meant to catch.
  const recurrenceSource = notesRange
    ? lines.filter((_, i) => i < notesRange[0] || i > notesRange[1]).join('\n')
    : text;
  const recurrence = detectRecurrence(recurrenceSource);

  const startTime = date && start ? combineDateAndTime(date, start) : null;
  const endTime = date && end ? combineDateAndTime(date, end) : null;

  return {
    title,
    date,
    startTime,
    endTime,
    link,
    organizer,
    notes,
    joinMeetingId,
    joinPasscode,
    repeat: recurrence?.repeat ?? null,
    daysOfWeek: recurrence?.daysOfWeek,
  };
}

/** Joins a URL that a screenshot's own layout wrapped across two or more
 * OCR lines back into one - absorbs any line immediately after one
 * containing "http" as long as it's purely space-free URL characters (a
 * genuine new piece of metadata, like "Meeting ID: 123 456" or a blank
 * line, never matches that and stops the join there). Only affects link
 * detection - see the comment where this is called from. */
function dewrapUrls(text: string): string {
  const rawLines = text.split('\n');
  const merged: string[] = [];
  let i = 0;
  while (i < rawLines.length) {
    let line = rawLines[i];
    if (/https?:\/\//i.test(line)) {
      let j = i + 1;
      while (j < rawLines.length && URL_CONTINUATION_RE.test(rawLines[j].trim())) {
        line += rawLines[j].trim();
        j++;
      }
      merged.push(line);
      i = j;
    } else {
      merged.push(line);
      i++;
    }
  }
  return merged.join('\n');
}

/**
 * Like parseMeetingText, but for a screenshot that shows a LIST of several
 * meetings at once (a day/agenda view) instead of one invite - Outlook,
 * Google Calendar and most calendar apps lay each entry out as its own
 * visually separated block, which OCR text usually preserves as a blank
 * line between entries. Returns one ParsedMeeting per entry it's confident
 * about, title/time included - nothing stripped out of each other's way the
 * way the single-meeting recurrence/notes logic has to worry about, since
 * each block is scanned entirely on its own.
 *
 * A screenshot of a single ordinary invite (Subject/When/Where/Organizer,
 * each its own blank-line-separated section) is NOT mistaken for a list:
 * it only ever has ONE line naming a time, and this requires at least two
 * separate blocks to each have their own before splitting at all - with
 * fewer than that, the whole screenshot is parsed exactly as
 * parseMeetingText() always has, so single-invite imports are unaffected.
 *
 * Best-effort like the rest of this file: assumes each entry's title comes
 * before its time (the common "title card, then time" layout) - a list
 * that shows time first and title below it per entry will still produce
 * meetings, just possibly with titles shifted by one entry.
 */
export function parseMeetingTextMulti(rawText: string): ParsedMeeting[] {
  const text = rawText.replace(/\r/g, '');
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const hasTime = (p: string) => TIME_RANGE_RE.test(p) || TIME_SINGLE_RE.test(p);
  const timeParagraphCount = paragraphs.filter(hasTime).length;

  if (paragraphs.length < 2 || timeParagraphCount < 2) {
    const single = parseMeetingText(rawText);
    return single.title || single.startTime ? [single] : [];
  }

  const blocks: string[][] = [];
  let pending: string[] = [];
  for (const para of paragraphs) {
    pending.push(para);
    if (hasTime(para)) {
      blocks.push(pending);
      pending = [];
    }
  }
  // Leftover paragraphs after the last time-anchor (a trailing location/
  // link/notes block) belong to that last meeting, not a dangling entry of
  // their own.
  if (pending.length) {
    if (blocks.length) blocks[blocks.length - 1].push(...pending);
    else blocks.push(pending);
  }

  // The date is usually shown once for the whole list (a header above the
  // entries) rather than repeated per entry - see parseMeetingText's
  // fallbackDate comment.
  const globalDate = extractDate(text);
  const meetings = blocks
    .map((block) => parseMeetingText(block.join('\n\n'), globalDate))
    .filter((m) => m.title || m.startTime);

  return meetings.length ? meetings : [parseMeetingText(rawText)];
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
    // Assumes DD/MM/YYYY (day first) - flip here if this ever needs to
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
    // If only the end time carries AM/PM, apply it to the start time too -
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
    if (NOTES_LABEL_RE.test(line)) continue;
    if (TIME_RANGE_RE.test(line) || TIME_SINGLE_RE.test(line)) continue;
    if (DATE_DAY_MONTH_YEAR_RE.test(line) || DATE_MONTH_DAY_YEAR_RE.test(line)) continue;
    if (/^https?:\/\//i.test(line)) continue;
    if (/^\S+@\S+\.\S+$/.test(line)) continue; // a bare email address
    return line;
  }

  return null;
}

/** "Organizer: Jane Doe" / "Organised by Jane Doe" on one line, or a lone
 * "Organizer"/"Organiser" label with the name on the next line (the
 * common Teams/Outlook screenshot layout). Returns the first match found. */
function extractOrganizer(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const labelMatch = ORGANIZER_LABEL_LINE_RE.exec(line);
    if (labelMatch && labelMatch[1].trim()) return labelMatch[1].trim();

    const byMatch = ORGANIZED_BY_RE.exec(line);
    if (byMatch && byMatch[1].trim()) return byMatch[1].trim();

    if (ORGANIZER_LABEL_ONLY_RE.test(line) && lines[i + 1]) {
      return lines[i + 1].trim();
    }
  }
  return null;
}

/** Pulls a short agenda/description/notes snippet out of whatever follows
 * an "Agenda"/"Description"/"Notes" label - up to MAX_NOTES_LINES lines,
 * stopping at the next recognized metadata line (Organizer, a meeting
 * link, etc.) so it doesn't swallow the rest of the screenshot. `range` is
 * the [label line, last collected line] index span, so the caller can
 * exclude this block from other line-based scans (see the recurrence
 * comment in parseMeetingText) - null when nothing was found. */
function extractNotes(lines: string[]): { notes: string | null; range: [number, number] | null } {
  const labelIndex = lines.findIndex((l) => NOTES_LABEL_RE.test(l));
  if (labelIndex === -1) return { notes: null, range: null };

  const sameLineMatch = NOTES_LABEL_RE.exec(lines[labelIndex]);
  const collected: string[] = sameLineMatch && sameLineMatch[2].trim() ? [sameLineMatch[2].trim()] : [];
  let lastIndex = labelIndex;

  for (let i = labelIndex + 1; i < lines.length && collected.length < MAX_NOTES_LINES; i++) {
    const line = lines[i];
    // SKIP_LINE_RE already matches "Organizer"/"Organiser" lines (and
    // "When"/"Where"/a join link etc.); a bare meeting link, a time, or a
    // date line (no "When:" label in front of it) marks the end of the
    // agenda/description block just the same.
    if (
      SKIP_LINE_RE.test(line) ||
      MEETING_LINK_RE.test(line) ||
      TIME_RANGE_RE.test(line) ||
      TIME_SINGLE_RE.test(line) ||
      DATE_DAY_MONTH_YEAR_RE.test(line) ||
      DATE_MONTH_DAY_YEAR_RE.test(line) ||
      DATE_NUMERIC_RE.test(line)
    ) {
      break;
    }
    collected.push(line);
    lastIndex = i;
  }

  return {
    notes: collected.length ? collected.join('\n').trim() : null,
    range: collected.length ? [labelIndex, lastIndex] : null,
  };
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
