import { Meeting } from '../types';
import { getAccessToken } from './googleAuth';

/** Fetches today's events from the signed-in Google account's primary
 * calendar. Mirrors fetchTodaysGraphMeetings's shape so TodayScreen can
 * treat Google, Microsoft, and the device calendar uniformly. */
export async function fetchTodaysGoogleMeetings(): Promise<Meeting[]> {
  const token = await getAccessToken();
  if (!token) return [];

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', startOfDay.toISOString());
  url.searchParams.set('timeMax', endOfDay.toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Google Calendar events request failed: ${res.status}`);
  }
  const json = await res.json();

  return (json.items ?? [])
    .filter((event: any) => event.status !== 'cancelled')
    .map((event: any): Meeting => ({
      id: `google-${event.id}`,
      title: event.summary || '(No title)',
      startTime: event.start?.dateTime ?? event.start?.date,
      endTime: event.end?.dateTime ?? event.end?.date ?? event.start?.dateTime,
      source: 'google',
      sourceEventId: event.id,
      meetingLink: event.hangoutLink ?? event.conferenceData?.entryPoints?.[0]?.uri ?? null,
      notes: event.description ?? null,
    }));
}
