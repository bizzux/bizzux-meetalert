# Meeting Reminder App — Starter Scaffold

Companion codebase for the "Meeting Reminder App — Product & Technical Spec" doc.
This is a **Phase 1–2 starter scaffold**, not a finished app: it lays out the
project structure, data model, and the reminder/alarm engine's logic so a real
build can start from something concrete rather than a blank Expo template.

## What's here

```
src/
  types.ts                 Shared TypeScript types (Meeting, AttendanceRecord, ...)
  db/database.ts           SQLite schema + queries (meetings, reminders, attendance)
  services/
    reminderEngine.ts      Core state machine: schedules 30/15/5/2-min reminders,
                            the T-0 alarm, and the 2-min snooze loop
    notifications.ts       Notifee wrapper — Android exact alarms vs iOS
                            scheduled notification series (see spec doc's
                            "Platform constraints" section for why they differ)
    graphAuth.ts            Microsoft Graph OAuth (MSAL) stub
    graphCalendar.ts        Fetches Teams/Outlook events via Graph
    localCalendar.ts        Reads the phone's local calendar
  screens/
    TodayScreen.tsx         Today's merged meeting list
    AddMeetingScreen.tsx    Manual meeting entry form
    HistoryScreen.tsx       Past meetings, attended/missed
  navigation/index.tsx      Stack navigator wiring the three screens
App.tsx                     Entry point
```

## Before this runs

This scaffold is **not runnable as-is**. To get a working build:

1. `npx create-expo-app` a real project and copy these files in (or use this
   folder as a starting point and run `expo prebuild` since native modules —
   Notifee, MSAL, calendar events — need a bare/dev-client build, not Expo Go).
2. Register an app in Azure AD / Microsoft Entra to get a client ID for
   `graphAuth.ts` (Calendars.Read scope).
3. On Android: request the `SCHEDULE_EXACT_ALARM` permission at runtime
   (Android 12+) before the alarm engine will fire reliably.
4. On iOS: read the spec doc's **Platform constraints** section before
   assuming the alarm will "ring" the way it does on Android — iOS gets a
   pre-scheduled series of Time Sensitive notifications instead of one
   continuous alarm, unless Apple grants a Critical Alerts entitlement.
5. `npm install` and `expo run:android` / `expo run:ios`.

## Design decisions baked into this scaffold

- **One `Meeting` table, all three sources normalized into it** (`source:
  'graph' | 'local_calendar' | 'manual'`) — the reminder engine never needs to
  know where a meeting came from.
- **`ReminderSchedule` is separate from `Meeting`** so the alarm engine reads
  and writes one small, fast table.
- **Confirmation is the only thing that stops an alarm** — there is no
  auto-detection of joining a Teams call; see the spec doc for why.
