export type MeetingSource = 'graph' | 'google' | 'local_calendar' | 'manual';

export interface Meeting {
  id: string;
  title: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  source: MeetingSource;
  sourceEventId?: string | null;
  meetingLink?: string | null;
  notes?: string | null;
  /** Shared id across every occurrence generated from one "Repeat" choice
   * on Add Meeting — null for a one-off meeting. */
  recurrenceId?: string | null;
}

// 'recurring' is the free-form option — the user picks any combination of
// weekdays via the horizontal day picker on Add Meeting. 'weekdays' and
// 'weekends' are just fixed shortcuts for the two most common combinations
// (Mon–Fri / Sat–Sun) and don't show that picker.
export type RepeatOption = 'none' | 'weekdays' | 'weekends' | 'recurring' | 'biweekly' | 'monthly';

/** How long a recurring series runs for — shown as the Outlook-style "Ends"
 * control on Add Meeting. Always paired with a hard occurrence cap so a
 * single save can never schedule an unbounded number of alarms. */
export type RecurrenceEndOption = '2w' | '1m' | '3m' | '6m';

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
  type: 'graph' | 'google' | 'local_calendar';
  authTokenRef?: string | null;
  lastSyncedAt?: string | null;
}
