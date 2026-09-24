import CalendarEvents, { CalendarEventReadable } from 'react-native-calendar-events';
import { Meeting } from '../types';

export async function fetchTodaysLocalMeetings(): Promise<Meeting[]> {
  const permission = await CalendarEvents.requestPermissions();
  if (permission !== 'authorized') return [];

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const events = await CalendarEvents.fetchAllEvents(
    startOfDay.toISOString(),
    endOfDay.toISOString()
  );

  return events.map((event: CalendarEventReadable): Meeting => ({
    id: `local-${event.id}`,
    title: event.title || '(No title)',
    startTime: event.startDate,
    // All-day events can omit endDate; fall back to start time so it's
    // still a valid Meeting rather than breaking the type.
    endTime: event.endDate ?? event.startDate,
    source: 'local_calendar',
    sourceEventId: event.id,
    meetingLink: null,
    notes: event.notes ?? null,
  }));
}

/**
 * Simple de-duplication against meetings already pulled from Microsoft
 * Graph: same title + same start time (within a minute) is treated as the
 * same meeting so it doesn't get double reminders.
 */
export function dedupeAgainstGraph(local: Meeting[], graph: Meeting[]): Meeting[] {
  return local.filter((l) => {
    return !graph.some((g) => {
      const sameTitle = g.title.trim().toLowerCase() === l.title.trim().toLowerCase();
      const timeDiffMs = Math.abs(new Date(g.startTime).getTime() - new Date(l.startTime).getTime());
      return sameTitle && timeDiffMs < 60_000;
    });
  });
}
