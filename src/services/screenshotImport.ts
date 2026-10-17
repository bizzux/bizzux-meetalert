// "Snap & Fill" - turn a screenshot of a meeting invite (Outlook, Teams,
// Google Calendar, Zoom, whatever) into a real meeting with reminders
// scheduled, with no manual typing. Three entry points feed into the same
// OCR+parse pipeline:
//   - pickAndImportScreenshot(): the in-app "Snap" button (Home screen),
//     auto-saves - see below.
//   - the Android/iOS share sheet, wired in App.tsx via expo-share-intent -
//     screenshot the invite in Outlook/Gmail/Photos, then "Share" -> BizzMinder.
//   - captureMeetingSnapshot(): the "Take snapshot" option on Add Meeting,
//     hands the parsed fields BACK to the form instead of saving directly,
//     since the person is already mid-way through filling that screen in
//     by hand.
//
// Both of the in-app entry points share choosePhotoSource() below so they
// behave identically: ask Camera or Gallery, then open whichever was
// picked, rather than one silently always opening the gallery.
//
// A screenshot can show MORE than one meeting (a day/agenda list rather
// than a single invite) - parseMeetingTextMulti() in parseMeetingText.ts is
// what tells the two apart, and both entry points below handle whatever
// number of meetings it finds: pickAndImportScreenshot() auto-saves every
// one of them (one combined summary alert instead of one-per-meeting), and
// captureMeetingSnapshot() hands back the whole list so Add Meeting can
// fill its form with the first and auto-save the rest via
// saveParsedMeetings() - that form can only ever edit one meeting at a time.
//
// OCR happens entirely on-device (src/services/ocr.ts, Google ML Kit) - no
// network call, no per-image cost. Parsing (src/utils/parseMeetingText.ts)
// is necessarily best-effort regex heuristics, not real NLP, so the result
// is always saved AND surfaced back to the person with an Edit shortcut -
// "automatic" here means no manual form-filling, not a black box with no
// way to correct a misread date or title. Besides title/time/link, the
// parser also makes a best effort at organizer, a Meeting ID/passcode, an
// agenda/notes snippet, and how often it repeats (ParsedMeeting.repeat) -
// this auto-save path carries all of those into the saved meeting(s) but
// can't expand a detected recurrence into a series (see
// buildMeetingFromParsed below); only the "Take snapshot" + Save path on
// Add Meeting can do that.
import * as ImagePicker from 'expo-image-picker';
import { recognizeTextFromImage } from './ocr';
import { parseMeetingTextMulti, ParsedMeeting } from '../utils/parseMeetingText';
import { upsertMeeting } from '../db/database';
import { scheduleMeeting } from './reminderEngine';
import { incrementUsageCount } from './cloudProfile';
import { Meeting } from '../types';
import { navigationRef } from '../navigation/navigationRef';
import { showAlert } from './appAlert';

/** Asks Camera or Gallery via the app's own alert card (see appAlert.ts),
 * resolving to which one was picked, or null if canceled. Shared by both
 * pickAndImportScreenshot() and captureMeetingSnapshot() so "Snap" and
 * "Take snapshot" behave the exact same way instead of one hard-coding the
 * gallery and the other the camera. */
function choosePhotoSource(): Promise<'camera' | 'gallery' | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const resolveOnce = (value: 'camera' | 'gallery' | null) => {
      if (resolved) return; // AppAlertHost only fires one button's onPress, but guard anyway
      resolved = true;
      resolve(value);
    };
    showAlert('Add a photo', 'Take a new photo, or choose one from your gallery?', [
      { text: 'Camera', onPress: () => resolveOnce('camera') },
      { text: 'Gallery', onPress: () => resolveOnce('gallery') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolveOnce(null) },
    ]);
  });
}

/** Requests the right permission for `source` and opens it, returning the
 * picked image's URI, or null if permission was refused (an alert is
 * shown) or the person canceled the picker (no alert - not an error). */
async function pickImage(source: 'camera' | 'gallery'): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert('Permission needed', 'BizzMinder needs camera access to snap a photo of your meeting invite.');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.[0]?.uri) return null;
    return result.assets[0].uri;
  }

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    showAlert('Permission needed', 'BizzMinder needs photo access to import your meeting screenshot.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0].uri;
}

/** Entry point for the in-app "Snap" button - asks Camera or Gallery, then
 * hands the picked image to processScreenshotUri(). */
export async function pickAndImportScreenshot(): Promise<void> {
  const source = await choosePhotoSource();
  if (!source) return;
  const uri = await pickImage(source);
  if (!uri) return;

  await processScreenshotUri(uri);
}

/** Entry point for the "Take snapshot" option on Add Meeting - asks Camera
 * or Gallery, OCRs and parses whatever photo was chosen, and hands the
 * parsed meeting(s) straight back to the caller instead of saving anything
 * itself. The person is already on the form, so the caller fills it in with
 * the FIRST meeting found for them to review and save with the normal Save
 * button; if the photo had more than one meeting in it (an agenda list, not
 * a single invite), the caller is expected to save the rest itself via
 * saveParsedMeetings() - see AddMeetingScreen's onCaptureSnapshot.
 *
 * Returns null when there's nothing to fill in: the chooser or permission
 * was canceled/refused (an alert is shown for a refusal, not a cancel), or
 * OCR found no usable title/time (an alert is shown). Otherwise always
 * returns at least one ParsedMeeting. */
export async function captureMeetingSnapshot(): Promise<ParsedMeeting[] | null> {
  const source = await choosePhotoSource();
  if (!source) return null;
  const uri = await pickImage(source);
  if (!uri) return null;

  try {
    const text = await recognizeTextFromImage(uri);
    const parsed = parseMeetingTextMulti(text);

    if (!parsed.length) {
      showAlert(
        "Couldn't read that photo",
        "We couldn't spot a title or time in it. Try a clearer shot, or fill in the details yourself."
      );
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn('[BizzMinder] snapshot capture failed', err);
    showAlert('Something went wrong', "We couldn't read that photo. You can fill in the details yourself instead.");
    return null;
  }
}

/** Turns one parsed screenshot result into a real (not yet saved) Meeting -
 * the shared shape both saveParsedMeetings() below and the "Edit" shortcut's
 * data come from, so a meeting saved via the Snap button and one saved via
 * Take Snapshot's "extra meetings" path are built identically. Each gets its
 * own id even when several are built in the same tick (two meetings found in
 * one screenshot at the same millisecond), since Date.now() alone isn't
 * unique enough there. */
function buildMeetingFromParsed(parsed: ParsedMeeting): Meeting {
  const start = parsed.startTime ?? roundToNextHour(new Date());
  const end = parsed.endTime ?? new Date(start.getTime() + 30 * 60_000);
  return {
    id: `screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: parsed.title ?? 'Imported meeting',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    source: 'manual',
    meetingLink: parsed.link ?? null,
    organizer: parsed.organizer ?? null,
    joinMeetingId: parsed.joinMeetingId ?? null,
    joinPasscode: parsed.joinPasscode ?? null,
    // An agenda/description block found in the screenshot wins, with the
    // import attribution tacked on; otherwise fall back to just the
    // attribution, same as before this field existed.
    notes: parsed.notes
      ? `${parsed.notes}\n\n(Imported from a screenshot via Snap & Fill.)`
      : 'Imported from a screenshot (Snap & Fill).',
    // Auto-saved meetings never expand a detected recurrence into a series
    // (see the recurrenceNote below processScreenshotUri) - only the "Take
    // snapshot" + Save path on Add Meeting can do that.
    recurrenceId: null,
  };
}

/** Saves one or more parsed screenshot results as real meetings - DB write
 * plus scheduled reminders for each, with a single usage-count bump for the
 * whole batch rather than one per meeting. Shared by pickAndImportScreenshot
 * (via processScreenshotUri, saving every meeting a screenshot had) and by
 * AddMeetingScreen's "Take snapshot" (saving whichever extra meetings came
 * back alongside the one it fills the form with). Returns the saved
 * Meetings in the same order as `parsedList`. */
export async function saveParsedMeetings(parsedList: ParsedMeeting[]): Promise<Meeting[]> {
  const meetings = parsedList.map(buildMeetingFromParsed);
  // Save every meeting to the DB first (fast, synchronous, can't fail from
  // a native call), same save-before-schedule ordering AddMeetingScreen
  // uses, so they're already on Home even if scheduling below has trouble.
  meetings.forEach(upsertMeeting);
  // Best-effort, fire-and-forget - feeds the admin app's usage metrics.
  incrementUsageCount('meetingsCreated', meetings.length);
  await Promise.all(meetings.map((meeting) => scheduleMeeting(meeting)));
  return meetings;
}

/** Pipeline for the Snap button / share-sheet entry points: OCR the image,
 * parse out however many meetings it contains, save all of them (with
 * reminders scheduled), then show a quick summary the person can tap
 * through (single meeting) or skim (several) to fix anything the parser
 * got wrong - see the file header for why this isn't a silent auto-save. */
export async function processScreenshotUri(uri: string): Promise<void> {
  try {
    const text = await recognizeTextFromImage(uri);
    const parsedList = parseMeetingTextMulti(text);

    if (!parsedList.length) {
      showAlert(
        "Couldn't read that screenshot",
        "We couldn't spot a title or time in it. Try a clearer screenshot, or add the meeting yourself."
      );
      return;
    }

    const meetings = await saveParsedMeetings(parsedList);

    if (meetings.length === 1) {
      const meeting = meetings[0];
      const parsed = parsedList[0];
      const start = new Date(meeting.startTime);
      const end = new Date(meeting.endTime);
      const recurrenceNote =
        parsed.repeat && parsed.repeat !== 'none'
          ? "\nLooks like a repeating meeting. Only this one occurrence was saved. To set up the full series, delete this and re-add it via Add Meeting > Take snapshot instead."
          : '';

      showAlert(
        `Added: ${meeting.title}`,
        `${formatSummary(start, end)}${parsed.link ? '\nMeeting link detected.' : ''}${recurrenceNote}\n\nDouble-check this looks right. It's already saved.`,
        [
          { text: 'Looks good', style: 'cancel' },
          {
            text: 'Edit',
            onPress: () => {
              if (navigationRef.isReady()) {
                navigationRef.navigate('AddMeeting', { meeting });
              }
            },
          },
        ]
      );
    } else {
      // More than one meeting in the shot - no single "Edit" shortcut makes
      // sense here (Add Meeting only ever edits one at a time), so this
      // just lists what got added; each one can still be edited or deleted
      // individually from Home like any other meeting.
      const titles = meetings.map((m) => m.title).join(', ');
      showAlert(
        `Added ${meetings.length} meetings`,
        `${titles}\n\nDouble-check these on Home. Each one was saved separately, so you can edit or delete any of them on its own.`
      );
    }
  } catch (err) {
    console.warn('[BizzMinder] screenshot import failed', err);
    showAlert(
      'Something went wrong',
      "We couldn't read that screenshot. You can add the meeting yourself instead."
    );
  }
}

function roundToNextHour(date: Date): Date {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function formatSummary(start: Date, end: Date): string {
  const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const startStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const endStr = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateStr}, ${startStr} to ${endStr}`;
}
