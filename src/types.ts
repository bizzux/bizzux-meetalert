export type MeetingSource = 'graph' | 'local_calendar' | 'manual';

export interface Meeting {
  id: string;
  title: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  source: MeetingSource;
  sourceEventId?: string | null;
  meetingLink?: string | null;
  notes?: string | null;
}

export type ReminderOffsetMinutes = 30 | 15 | 5 | 2;

export interface ReminderSchedule {
  meetingId: string;
  offsetsSent: Record<ReminderOffsetMinutes, boolean>;
  ringingStartedAt?: string | null;
  nextSnoozeAt?: string | null;
}

export type AttendanceStatus = 'attended' | 'missed';

export interface AttendanceRecord {
  meetingId: string;
  status: AttendanceStatus;
  confirmedAt?: string | null;
  createdAt: string;
}

export interface CalendarSource {
  id: string;
  type: 'graph' | 'local_calendar';
  authTokenRef?: string | null;
  lastSyncedAt?: string | null;
}
