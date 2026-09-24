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
  `);
}

export function upsertMeeting(meeting: Meeting): void {
  db.runSync(
    `INSERT INTO meetings (id, title, start_time, end_time, source, source_event_id, meeting_link, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, start_time=excluded.start_time, end_time=excluded.end_time,
       meeting_link=excluded.meeting_link, notes=excluded.notes`,
    [
      meeting.id,
      meeting.title,
      meeting.startTime,
      meeting.endTime,
      meeting.source,
      meeting.sourceEventId ?? null,
      meeting.meetingLink ?? null,
      meeting.notes ?? null,
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

export function recordAttendance(record: AttendanceRecord): void {
  db.runSync(
    `INSERT INTO attendance_records (meeting_id, status, confirmed_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(meeting_id) DO UPDATE SET status=excluded.status, confirmed_at=excluded.confirmed_at`,
    [record.meetingId, record.status, record.confirmedAt ?? null, record.createdAt]
  );
}

export function getHistory(limit = 50): (Meeting & { status?: string; confirmedAt?: string | null })[] {
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
  };
}
