// "Snap & Fill" — turn a screenshot of a meeting invite (Outlook, Teams,
// Google Calendar, Zoom, whatever) into a real meeting with reminders
// scheduled, with no manual typing. Three entry points feed into the same
// OCR+parse pipeline:
//   - pickAndImportScreenshot(): the in-app "Import from screenshot" button
//     (Home screen), opens the photo gallery, then auto-saves — see below.
//   - the Android/iOS share sheet, wired in App.tsx via expo-share-intent —
//     screenshot the invite in Outlook/Gmail/Photos, then "Share" -> BizzMinder.
//   - captureMeetingSnapshot(): the "Take snapshot" option on Add Meeting,
//     opens the camera and hands the parsed fields BACK to the form instead
//     of saving directly, since the person is already mid-way through
//     filling that screen in by hand.
//
// OCR happens entirely on-device (src/services/ocr.ts, Google ML Kit) — no
// network call, no per-image cost. Parsing (src/utils/parseMeetingText.ts)
// is necessarily best-effort regex heuristics, not real NLP, so the result
// is always saved AND surfaced back to the person with an Edit shortcut —
// "automatic" here means no manual form-filling, not a black box with no
// way to correct a misread date or title.
import * as ImagePicker from 'expo-image-picker';
import { recognizeTextFromImage } from './ocr';
import { parseMeetingText, ParsedMeeting } from '../utils/parseMeetingText';
import { upsertMeeting } from '../db/database';
import { scheduleMeeting } from './reminderEngine';
import { Meeting } from '../types';
import { navigationRef } from '../navigation/navigationRef';
import { showAlert } from './appAlert';

/** Entry point for the in-app "Import from screenshot" button — opens the
 * photo gallery, then hands the picked image to processScreenshotUri(). */
export async function pickAndImportScreenshot(): Promise<void> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    showAlert('Permission needed', 'BizzMinder needs access to your photos to import a meeting screenshot.');
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return;

  await processScreenshotUri(result.assets[0].uri);
}

/** Entry point for the "Take snapshot" option on Add Meeting — opens the
 * camera (not the gallery), OCRs and parses whatever was photographed, and
 * hands the parsed fields straight back to the caller instead of saving a
 * meeting itself. The person is already on the form, so this fills it in
 * for them to review and save with the normal Save button, rather than
 * creating a second, separate meeting behind their back.
 *
 * Returns null when there's nothing to fill in: permission was refused
 * (an alert is shown), the person canceled the camera (no alert — that's
 * not an error), or OCR found no usable title/time (an alert is shown). */
export async function captureMeetingSnapshot(): Promise<ParsedMeeting | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    showAlert('Permission needed', 'BizzMinder needs camera access to take a photo of a meeting invite.');
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;

  try {
    const text = await recognizeTextFromImage(result.assets[0].uri);
    const parsed = parseMeetingText(text);

    if (!parsed.title && !parsed.startTime) {
      showAlert(
        "Couldn't read that photo",
        "BizzMinder couldn't find a meeting title or time in that photo. Try a clearer shot, or fill the details in by hand."
      );
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn('[BizzMinder] snapshot capture failed', err);
    showAlert('Something went wrong', "BizzMinder couldn't process that photo. You can fill the details in by hand instead.");
    return null;
  }
}

/** Shared pipeline for both entry points: OCR the image, parse out meeting
 * details, save it as a real meeting (with reminders scheduled), then show
 * a quick summary the person can tap through to fix anything the parser
 * got wrong — see the file header for why this isn't a silent auto-save. */
export async function processScreenshotUri(uri: string): Promise<void> {
  try {
    const text = await recognizeTextFromImage(uri);
    const parsed = parseMeetingText(text);

    if (!parsed.title && !parsed.startTime) {
      showAlert(
        "Couldn't read that screenshot",
        "BizzMinder couldn't find a meeting title or time in that image. Try a clearer screenshot, or add the meeting manually."
      );
      return;
    }

    const start = parsed.startTime ?? roundToNextHour(new Date());
    const end = parsed.endTime ?? new Date(start.getTime() + 30 * 60_000);

    const meeting: Meeting = {
      id: `screenshot-${Date.now()}`,
      title: parsed.title ?? 'Imported meeting',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      source: 'manual',
      meetingLink: parsed.link ?? null,
      notes: 'Imported from a screenshot (Snap & Fill).',
      recurrenceId: null,
    };

    // Save first (fast, synchronous, can't fail from a native call), same
    // save-before-schedule ordering AddMeetingScreen uses — the meeting is
    // already on Home even if reminder scheduling below has trouble.
    upsertMeeting(meeting);
    await scheduleMeeting(meeting);

    showAlert(
      `Added: ${meeting.title}`,
      `${formatSummary(start, end)}${parsed.link ? '\nMeeting link detected.' : ''}\n\nDouble-check this looks right. It's already saved.`,
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
  } catch (err) {
    console.warn('[BizzMinder] screenshot import failed', err);
    showAlert(
      'Something went wrong',
      "BizzMinder couldn't process that screenshot. You can add the meeting manually instead."
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
