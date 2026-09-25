import * as SQLite from 'expo-sqlite';
import { Meeting, ReminderSchedule, AttendanceRecord } from '../types';

const db = SQLite.openDatabaseSync('meetings.db');

// ---------------------------------------------------------------------------
// Current-user scoping
//
// Meetera moved from a single-user, single-dataset app to real accounts
// (see src/store/authStore.ts). Rather than threading a userId parameter
// through every function and every call site across the app, the signed-in
// user's uid is tracked here as module state — authStore calls
// setCurrentUserId() once, right after Firebase resolves who's signed in
// (and setCurrentUserId(null) on sign-out), and every query below scopes
// itself to that uid automatically. This keeps existing call sites
// (upsertMeeting(meeting), getSetting(key, fallback), etc.) unchanged.
// ---------------------------------------------------------------------------
let currentUserId: string | null = null;

export function setCurrentUserId(uid: string | null): void {
  currentUserId = uid;
  if (uid) {
    // Bare, unscoped key (deliberately not run through scopedKey()) so the
    // background sweep task can recover it below even when the OS killed
    // the app and re-launched this task in a fresh JS context that never
    // ran App.tsx's auth listener.
    db.runSync(
      `INSERT INTO settings (key, value) VALUES ('__lastSignedInUid', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(uid)]
    );
  }
}

/** Recovers the last signed-in uid from disk when nothing has called
 * setCurrentUserId() yet in this JS context — the background-fetch sweep
 * (backgroundTasks.ts) calls this first thing, since Android/iOS may run it
 * in a headless context after the app process was terminated, where
 * App.tsx's onAuthStateChanged listener never ran. Firebase itself still
 * restores the real session lazily on first auth() call in that context;
 * this only restores which uid to scope local SQLite reads/writes to. */
export function restoreLastKnownUserId(): string | null {
  if (currentUserId) return currentUserId;
  const row = db.getFirstSync<any>(`SELECT value FROM settings WHERE key = '__lastSignedInUid'`);
  if (!row) return null;
  try {
    currentUserId = JSON.parse(row.value);
  } catch {
    return null;
  }
  return currentUserId;
}

function requireUserId(): string {
  if (!currentUserId) {
    throw new Error('database: no signed-in user — setCurrentUserId() must be called first');
  }
  return currentUserId;
}

export function initDatabase(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      source TEXT NOT NULL,
      source_event_id TEXT,
      meeting_link TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS reminder_schedule (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      offset_30_sent INTEGER DEFAULT 0,
      offset_15_sent INTEGER DEFAULT 0,
      offset_5_sent INTEGER DEFAULT 0,
      offset_2_sent INTEGER DEFAULT 0,
      ringing_started_at TEXT,
      next_snooze_at TEXT
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      status TEXT NOT NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      auth_token_ref TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Additive migration for recurring meetings (added after the meetings
  // table already existed on devices) — SQLite has no "ADD COLUMN IF NOT
  // EXISTS", so we just try and ignore the "duplicate column" error on a
  // database that already has it.
  try {
    db.execSync(`ALTER TABLE meetings ADD COLUMN recurrence_id TEXT`);
  } catch {
    // column already exists
  }

  // Additive migration for accounts (see src/store/authStore.ts) — rows
  // created before sign-in existed have user_id = NULL until
  // claimLegacyDataIfNeeded() attaches them to whoever signs in first.
  try {
    db.execSync(`ALTER TABLE meetings ADD COLUMN user_id TEXT`);
  } catch {
    // column already exists
  }
}

/**
 * One-time migration from the single-user era: attaches every pre-existing
 * meeting (user_id IS NULL) and every legacy, unscoped settings/
 * calendar_sources row to the first account that ever signs in, then flips
 * a flag so it never runs again. Safe to call on every sign-in — it's a
 * no-op once the flag is set. Called from authStore right after
 * setCurrentUserId() on a successful sign-in.
 */
export function claimLegacyDataIfNeeded(uid: string): void {
  const flag = db.getFirstSync<any>(`SELECT value FROM settings WHERE key = ?`, ['__legacyDataClaimed']);
  if (flag) return;

  db.runSync(`UPDATE meetings SET user_id = ? WHERE user_id IS NULL`, [uid]);

  // Legacy settings/calendar_sources rows were stored under their bare key
  // (e.g. "themeMode"), never "<uid>:themeMode" — copy each one forward to
  // this account's scoped key so their saved preferences carry over.
  const legacySettings = db.getAllSync<any>(`SELECT key, value FROM settings WHERE key NOT LIKE '%:%'`);
  for (const row of legacySettings) {
    if (row.key === '__legacyDataClaimed') continue;
    db.runSync(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [`${uid}:${row.key}`, row.value]
    );
  }

  const legacySources = db.getAllSync<any>(`SELECT id, type, auth_token_ref, last_synced_at FROM calendar_sources WHERE id NOT LIKE '%:%'`);
  for (const row of legacySources) {
    db.runSync(
      `INSERT INTO calendar_sources (id, type, auth_token_ref, last_synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
      [`${uid}:${row.id}`, row.type, row.auth_token_ref, row.last_synced_at]
    );
  }

  db.runSync(
    `INSERT INTO settings (key, value) VALUES ('__legacyDataClaimed', 'true')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
}

// ---------------------------------------------------------------------------
// Settings (simple key-value store, JSON-encoded values) — backs the
// zustand settings store so preferences survive app restarts without adding
// a native storage dependency; we already ship expo-sqlite.
// ---------------------------------------------------------------------------

/** Scopes a settings/calendar_sources key to the signed-in user, so two
 * accounts on the same device never see each other's saved values. Falls
 * back to the bare key when nobody's signed in yet (e.g. very first launch,
 * before auth resolves) — claimLegacyDataIfNeeded() reconciles those once a
 * user signs in. */
function scopedKey(key: string): string {
  return currentUserId ? `${currentUserId}:${key}` : key;
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.getFirstSync<any>(`SELECT value FROM settings WHERE key = ?`, [scopedKey(key)]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.runSync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [scopedKey(key), JSON.stringify(value)]
  );
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export function upsertMeeting(meeting: Meeting): void {
  const uid = requireUserId();
  db.runSync(
    `INSERT INTO meetings (id, title, start_time, end_time, source, source_event_id, meeting_link, notes, recurrence_id, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, start_time=excluded.start_time, end_time=excluded.end_time,
       meeting_link=excluded.meeting_link, notes=excluded.notes, recurrence_id=excluded.recurrence_id`,
    [
      meeting.id,
      meeting.title,
      meeting.startTime,
      meeting.endTime,
      meeting.source,
      meeting.sourceEventId ?? null,
      meeting.meetingLink ?? null,
      meeting.notes ?? null,
      meeting.recurrenceId ?? null,
      uid,
    ]
  );

  db.runSync(
    `INSERT OR IGNORE INTO reminder_schedule (meeting_id) VALUES (?)`,
    [meeting.id]
  );
}

export function getMeetingsForDay(dayStartISO: string, dayEndISO: string): Meeting[] {
  const rows = db.getAllSync<any>(
    `SELECT * FROM meetings WHERE start_time >= ? AND start_time < ? AND user_id = ? ORDER BY start_time ASC`,
    [dayStartISO, dayEndISO, requireUserId()]
  );
  return rows.map(rowToMeeting);
}

/** Every meeting that hasn't finished yet, from now onward — not just
 * today. Powers the Home screen's agenda/timeline views, so a meeting
 * scheduled for next week shows up there immediately instead of waiting
 * until that day arrives. `limit` is a safety cap, not a UI page size —
 * 200 comfortably covers weeks of normal use. */
export function getUpcomingMeetings(nowISO: string, limit = 200): Meeting[] {
  const rows = db.getAllSync<any>(
    `SELECT * FROM meetings WHERE end_time > ? AND user_id = ? ORDER BY start_time ASC LIMIT ?`,
    [nowISO, requireUserId(), limit]
  );
  return rows.map(rowToMeeting);
}

export function getMeeting(meetingId: string): Meeting | null {
  const row = db.getFirstSync<any>(`SELECT * FROM meetings WHERE id = ? AND user_id = ?`, [meetingId, requireUserId()]);
  return row ? rowToMeeting(row) : null;
}

/**
 * Meetings that have started (or are about to, within toleranceMs) but have
 * no attendance_records row yet — i.e. still unresolved. Used by the
 * background sweep to catch missed meetings and re-announce ringing ones.
 */
export function getUnresolvedStartedMeetings(nowISO: string): Meeting[] {
  const rows = db.getAllSync<any>(
    `SELECT m.* FROM meetings m
     LEFT JOIN attendance_records a ON a.meeting_id = m.id
     WHERE m.start_time <= ? AND a.meeting_id IS NULL AND m.user_id = ?`,
    [nowISO, requireUserId()]
  );
  return rows.map(rowToMeeting);
}

export function markOffsetSent(meetingId: string, offset: 30 | 15 | 5 | 2): void {
  const column = `offset_${offset}_sent`;
  db.runSync(`UPDATE reminder_schedule SET ${column} = 1 WHERE meeting_id = ?`, [meetingId]);
}

export function setRinging(meetingId: string, startedAtISO: string, nextSnoozeAtISO: string): void {
  db.runSync(
    `UPDATE reminder_schedule SET ringing_started_at = ?, next_snooze_at = ? WHERE meeting_id = ?`,
    [startedAtISO, nextSnoozeAtISO, meetingId]
  );
}

/** Which of the 30/15/5/2-minute reminders have fired for a meeting, plus
 * whether it's currently ringing — drives the progress dots on TodayScreen. */
export function getReminderProgress(meetingId: string): {
  sent: Record<30 | 15 | 5 | 2, boolean>;
  ringing: boolean;
} {
  const row = db.getFirstSync<any>(`SELECT * FROM reminder_schedule WHERE meeting_id = ?`, [meetingId]);
  if (!row) {
    return { sent: { 30: false, 15: false, 5: false, 2: false }, ringing: false };
  }
  return {
    sent: {
      30: !!row.offset_30_sent,
      15: !!row.offset_15_sent,
      5: !!row.offset_5_sent,
      2: !!row.offset_2_sent,
    },
    ringing: !!row.ringing_started_at,
  };
}

export function recordAttendance(record: AttendanceRecord): void {
  db.runSync(
    `INSERT INTO attendance_records (meeting_id, status, confirmed_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(meeting_id) DO UPDATE SET status=excluded.status, confirmed_at=excluded.confirmed_at`,
    [record.meetingId, record.status, record.confirmedAt ?? null, record.createdAt]
  );
}

export function getHistory(limit = 100): (Meeting & { status?: string; confirmedAt?: string | null })[] {
  const rows = db.getAllSync<any>(
    `SELECT m.*, a.status, a.confirmed_at
     FROM meetings m
     LEFT JOIN attendance_records a ON a.meeting_id = m.id
     WHERE m.user_id = ?
     ORDER BY m.start_time DESC
     LIMIT ?`,
    [requireUserId(), limit]
  );
  return rows.map((r) => ({ ...rowToMeeting(r), status: r.status, confirmedAt: r.confirmed_at }));
}

/** History filtered to a period, for the This week / This month / All time
 * segmented control on HistoryScreen. */
export function getHistorySince(sinceISO: string | null, limit = 200) {
  if (!sinceISO) return getHistory(limit);
  const rows = db.getAllSync<any>(
    `SELECT m.*, a.status, a.confirmed_at
     FROM meetings m
     LEFT JOIN attendance_records a ON a.meeting_id = m.id
     WHERE m.start_time >= ? AND m.user_id = ?
     ORDER BY m.start_time DESC
     LIMIT ?`,
    [sinceISO, requireUserId(), limit]
  );
  return rows.map((r) => ({ ...rowToMeeting(r), status: r.status, confirmedAt: r.confirmed_at }));
}

/** Attended / missed / attendance-rate counts for a period — backs the
 * stat cards at the top of HistoryScreen. */
export function getAttendanceStats(sinceISO: string | null): {
  attended: number;
  missed: number;
  attendanceRate: number;
} {
  const params: any[] = [requireUserId()];
  let where = `WHERE a.status IS NOT NULL AND m.user_id = ?`;
  if (sinceISO) {
    where += ` AND m.start_time >= ?`;
    params.push(sinceISO);
  }
  const row = db.getFirstSync<any>(
    `SELECT
       SUM(CASE WHEN a.status = 'attended' THEN 1 ELSE 0 END) AS attended,
       SUM(CASE WHEN a.status = 'missed' THEN 1 ELSE 0 END) AS missed
     FROM meetings m
     LEFT JOIN attendance_records a ON a.meeting_id = m.id
     ${where}`,
    params
  );
  const attended = row?.attended ?? 0;
  const missed = row?.missed ?? 0;
  const total = attended + missed;
  return { attended, missed, attendanceRate: total > 0 ? Math.round((attended / total) * 100) : 0 };
}

export function deleteMeeting(meetingId: string): void {
  db.runSync(`DELETE FROM attendance_records WHERE meeting_id = ?`, [meetingId]);
  db.runSync(`DELETE FROM reminder_schedule WHERE meeting_id = ?`, [meetingId]);
  db.runSync(`DELETE FROM meetings WHERE id = ? AND user_id = ?`, [meetingId, requireUserId()]);
}

export function touchCalendarSourceSync(id: string, type: 'graph' | 'local_calendar'): void {
  db.runSync(
    `INSERT INTO calendar_sources (id, type, last_synced_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
    [scopedKey(id), type, new Date().toISOString()]
  );
}

export function getCalendarSourceSync(id: string): string | null {
  const row = db.getFirstSync<any>(`SELECT last_synced_at FROM calendar_sources WHERE id = ?`, [scopedKey(id)]);
  return row?.last_synced_at ?? null;
}

function rowToMeeting(row: any): Meeting {
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time,
    source: row.source,
    sourceEventId: row.source_event_id,
    meetingLink: row.meeting_link,
    notes: row.notes,
    recurrenceId: row.recurrence_id ?? null,
  };
}

/** Deletes every occurrence sharing a recurrence id — used when the user
 * chooses "delete the whole series" for a recurring meeting. */
export function deleteRecurrenceSeries(recurrenceId: string): void {
  const rows = db.getAllSync<any>(
    `SELECT id FROM meetings WHERE recurrence_id = ? AND user_id = ?`,
    [recurrenceId, requireUserId()]
  );
  for (const row of rows) {
    deleteMeeting(row.id);
  }
}
