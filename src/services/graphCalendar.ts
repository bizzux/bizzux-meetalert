import { Meeting } from '../types';
import { acquireTokenSilent } from './graphAuth';

/**
 * Fetches today's calendar events from Microsoft Graph. This one endpoint
 * covers BOTH Teams meetings and Outlook calendar events, since a Teams
 * meeting is just a calendar event with a Teams join link attached — see
 * the spec doc's "Calendar integration" section for why this is one
 * integration, not two.
 */
export async function fetchTodaysGraphMeetings(): Promise<Meeting[]> {
  const token = await acquireTokenSilent();
  if (!token) return [];

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const url = new URL('https://graph.microsoft.com/v1.0/me/calendarView');
  url.searchParams.set('startDateTime', startOfDay.toISOString());
  url.searchParams.set('endDateTime', endOfDay.toISOString());
  url.searchParams.set('$orderby', 'start/dateTime');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Graph calendarView request failed: ${res.status}`);
  }
  const json = await res.json();

  return (json.value ?? []).map((event: any): Meeting => ({
    id: `graph-${event.id}`,
    title: event.subject || '(No title)',
    startTime: event.start.dateTime + 'Z',
    endTime: event.end.dateTime + 'Z',
    source: 'graph',
    sourceEventId: event.id,
    meetingLink: event.onlineMeeting?.joinUrl ?? null,
    notes: null,
  }));
}
