import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { sweepMeetingStates } from './reminderEngine';
import { fetchTodaysGraphMeetings } from './graphCalendar';
import { fetchTodaysLocalMeetings, dedupeAgainstGraph } from './localCalendar';
import { upsertMeeting, restoreLastKnownUserId } from '../db/database';
import { scheduleMeeting } from './reminderEngine';

const SWEEP_TASK_NAME = 'meeting-reminder-background-sweep';

TaskManager.defineTask(SWEEP_TASK_NAME, async () => {
  try {
    // The OS can run this task in a headless JS context after the app
    // process was killed (stopOnTerminate: false below) — App.tsx's
    // onAuthStateChanged listener never ran in that case, so database.ts
    // wouldn't know which account to scope reads/writes to. Recover it from
    // disk before touching anything meeting-related. No signed-in user has
    // ever completed a sign-in yet (fresh install) → nothing to sweep.
    const uid = restoreLastKnownUserId();
    if (!uid) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // 1. Resync calendars so newly added/moved meetings pick up reminders.
    const graphMeetings = await fetchTodaysGraphMeetings().catch(() => []);
    const localMeetingsRaw = await fetchTodaysLocalMeetings().catch(() => []);
    const localMeetings = dedupeAgainstGraph(localMeetingsRaw, graphMeetings);

    for (const meeting of [...graphMeetings, ...localMeetings]) {
      upsertMeeting(meeting);
      await scheduleMeeting(meeting);
    }

    // 2. Sweep for meetings that started and ended with no confirmation,
    //    and mark them Missed. Also re-announces still-ringing Android alarms.
    await sweepMeetingStates();

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (err) {
    console.warn('Background sweep failed', err);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Registers the periodic background task. iOS and Android both treat
 * `minimumInterval` as a *minimum* — the OS decides the actual frequency
 * based on battery, usage patterns, and platform policy, so this is a
 * best-effort refresh, not a guarantee. It complements (never replaces) the
 * notifications already scheduled in advance by scheduleMeeting(), which
 * fire independently of whether this task runs.
 */
export async function registerBackgroundSweepTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(SWEEP_TASK_NAME);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(SWEEP_TASK_NAME, {
    minimumInterval: 15 * 60, // seconds; OS-dependent actual frequency
    stopOnTerminate: false,
    startOnBoot: true,
  });
}
