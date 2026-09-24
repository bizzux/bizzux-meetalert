# Getting this running on your machine

I couldn't run commands directly on your computer from this session (no
shell access to it), so these are the exact commands to run yourself,
in order, from a terminal (PowerShell or Command Prompt) on
`thilak-legionpro5`.

## 1. Turn the bundle into a real git repo at the path you asked for

A `MeetAlert.bundle` file (the full repo, including commit history) is
already sitting in `D:\Projects`. Turn it into a working repo:

```powershell
cd D:\Projects
git clone MeetAlert.bundle MeetAlert
cd MeetAlert
```

This creates `D:\Projects\MeetAlert` as a real git repository on branch
`master`, with the one initial commit already in its history. You can
delete `D:\Projects\MeetAlert.bundle` afterwards — it was only there to get
the repo across.

(If `git` isn't recognized, install Git for Windows first:
https://git-scm.com/download/win)

## 2. Install dependencies

```powershell
npm install
```

This was verified to install cleanly and type-check with zero errors
(`npx tsc --noEmit`) before being handed to you.

## 3. Set up Microsoft Graph (Teams/Outlook calendar)

1. Go to https://portal.azure.com → **App registrations** → **New registration**.
2. Name it (e.g. "MeetAlert"), leave supported account types as your
   organization's default, add a redirect URI matching the app's bundle ID
   (`com.indiabees.meetingreminder`, set in `app.json`).
3. Under **API permissions**, add Microsoft Graph → Delegated →
   `Calendars.Read`, and grant admin consent if your tenant requires it.
4. Copy the **Application (client) ID** and paste it into
   `src/services/graphAuth.ts` in place of `TODO-your-azure-app-client-id`.

## 4. Run it

```powershell
npx expo prebuild
npx expo run:android
```

`expo prebuild` generates the native `android/` (and `ios/`) folders — this
project uses native modules (Notifee, MSAL, calendar access) that need a
dev build, not Expo Go.

For iOS you'll need a Mac with Xcode, or `eas build --platform ios` via an
Expo account (see https://docs.expo.dev/build/setup/) — see the spec doc's
"Platform constraints" section for why the iOS alarm behavior differs from
Android's.

## What's verified vs. what's still a stub

Verified (installs, type-checks clean):
- Full project structure, SQLite schema, navigation, all three screens
- Reminder/alarm engine logic and the Notifee scheduling calls
- `react-native-calendar-events` and `react-native-msal` integration code,
  checked against their actual published type definitions

Still needs you to fill in before it does anything real:
- Your Azure app registration's client ID (step 3 above)
- Running `expo prebuild` + a native build — I can't produce that from here,
  it has to happen on a machine with the Android/iOS SDKs
- No automated tests yet — worth adding once the alarm engine is running on
  a real device, since its correctness matters most under real OS
  scheduling behavior
