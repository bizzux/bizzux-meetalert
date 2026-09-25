import * as SQLite from 'expo-sqlite';
import { Meeting, ReminderSchedule, AttendanceRecord } from '../types';

const db = SQLite.openDatabaseSync('meetings.db');

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
}

// ---------------------------------------------------------------------------
// Settings (simple key-value store, JSON-encoded values) — backs the
// zustand settings store so preferences survive app restarts without adding
// a native storage dependency; we already ship expo-sqlite.
// ---------------------------------------------------------------------------

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.getFirstSync<any>(`SELECT value FROM settings WHERE key = ?`, [key]);
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
    [key, JSON.stringify(value)]
  );
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export function upsertMeeting(meeting: Meeting): void {
  db.runSync(
    `INSERT INTO meetings (id, title, start_time, end_time, source, source_event_id, meeting_link, notes, recurrence_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    ]
  );

  db.runSync(
    `INSERT OR IGNORE INTO reminder_schedule (meeting_id) VALUES (?)`,
    [meeting.id]
  );
}

export function getMeetingsForDay(dayStartISO: string, dayEndISO: string): Meeting[] {
  const rows = db.getAllSync<any>(
    `SELECT * FROM meetings WHERE start_time >= ? AND start_time < ? ORDER BY start_time ASC`,
    [dayStartISO, dayEndISO]
  );
  return rows.map(rowToMeeting);
}

export function getMeeting(meetingId: string): Meeting | null {
  const row = db.getFirstSync<any>(`SELECT * FROM meetings WHERE id = ?`, [meetingId]);
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
     WHERE m.start_time <= ? AND a.meeting_id IS NULL`,
    [nowISO]
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
     ORDER BY m.start_time DESC
     LIMIT ?`,
    [limit]
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
     WHERE m.start_time >= ?
     ORDER BY m.start_time DESC
     LIMIT ?`,
    [sinceISO, limit]
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
  const params: any[] = [];
  let where = `WHERE a.status IS NOT NULL`;
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
  db.runSync(`DELETE FROM meetings WHERE id = ?`, [meetingId]);
}

export function touchCalendarSourceSync(id: string, type: 'graph' | 'local_calendar'): void {
  db.runSync(
    `INSERT INTO calendar_sources (id, type, last_synced_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
    [id, type, new Date().toISOString()]
  );
}

export function getCalendarSourceSync(id: string): string | null {
  const row = db.getFirstSync<any>(`SELECT last_synced_at FROM calendar_sources WHERE id = ?`, [id]);
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
  const rows = db.getAllSync<any>(`SELECT id FROM meetings WHERE recurrence_id = ?`, [recurrenceId]);
  for (const row of rows) {
    deleteMeeting(row.id);
  }
}
