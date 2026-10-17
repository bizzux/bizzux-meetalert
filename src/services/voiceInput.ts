// Voice capture for Add Meeting's quick-fill box - records spoken meeting
// details and resolves with the transcript, or null if the mic permission
// was denied, nothing was understood, or recognition failed for any other
// reason. Mirrors captureMeetingSnapshot()'s "no result → caller just does
// nothing" contract, so AddMeetingScreen doesn't need special-case error UI
// for every possible mic/permission failure - it already has one for "text
// didn't parse" via parseQuickAdd(), which runs on whatever this returns.
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

// Hard safety cap for a recording the person never taps to stop themselves
// (see AddMeetingScreen's onVoiceInput, which calls cancelVoiceCapture()
// below on a second tap of the mic button) - 3 minutes is far longer than
// any real "add a meeting" phrase needs; it only exists so the mic can
// never stay open indefinitely.
const MAX_RECORDING_MS = 3 * 60 * 1000;

export async function captureVoiceText(): Promise<string | null> {
  const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!permission.granted) return null;

  return new Promise((resolve) => {
    // Every *finalized* segment heard so far, joined together. continuous
    // mode (below) fires a separate "result" {isFinal:true} event per
    // natural pause in speech rather than one result for the whole
    // recording, and the package's own docs are explicit that each one is a
    // NEW segment, not a revised guess at the same one - so these are
    // appended, never replaced (that's what let the old continuous:false
    // version "take only the first bit" - a pause anywhere in the phrase
    // read as the end of the whole utterance, cutting the rest off).
    // The current in-progress segment's latest partial guess - replaced on
    // every interim event for that same segment, and folded into
    // `finalizedText` once that segment actually finalizes. Kept separately
    // so a recording stopped mid-segment (see finish() below, and
    // cancelVoiceCapture()) still returns whatever was heard of that last
    // segment instead of silently dropping it.
    let finalizedText = '';
    let interimText = '';
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(maxDurationTimer);
      resultSub.remove();
      errorSub.remove();
      endSub.remove();
      resolve(value);
    };

    const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event) => {
      const best = event.results?.[0]?.transcript;
      if (!best) return;
      if (event.isFinal) {
        finalizedText = finalizedText ? `${finalizedText} ${best}`.trim() : best;
        interimText = '';
      } else {
        interimText = best;
      }
    });
    const errorSub = ExpoSpeechRecognitionModule.addListener('error', () => finish(null));
    // "end" fires once, at the very end of the whole (possibly multi-
    // segment) recording - every finalized segment plus whatever's left of
    // an in-progress one (e.g. the person stopped it before that last
    // segment finalized) together make up the complete transcript.
    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      finish(`${finalizedText} ${interimText}`.trim() || null);
    });

    // Without this, continuous mode (below) has no natural end of its own -
    // the person has to tap the mic again, and this is the fallback if they
    // never do.
    const maxDurationTimer = setTimeout(() => {
      ExpoSpeechRecognitionModule.stop();
    }, MAX_RECORDING_MS);

    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      // Lets a longer phrase with natural pauses ("Meeting... with the
      // design team... at 3pm") keep being heard instead of ending
      // recognition at the first bit of silence, which is what was cutting
      // people off before they finished speaking. The person taps the mic
      // again to stop it themselves (AddMeetingScreen's onVoiceInput), or
      // MAX_RECORDING_MS above cuts it off if they never do. Not supported
      // on Android 12 and below, where this silently behaves as before.
      continuous: true,
      // Needed to see a segment's own in-progress text (the `interimText`
      // above) instead of only ever getting text once a segment ends.
      interimResults: true,
    });
  });
}

/** Lets the screen cancel an in-progress capture (e.g. the user backs out
 * or taps the mic button again while it's listening) - stop(), not
 * abort(), so whatever was already heard still comes back through the
 * normal "result"/"end" events above instead of being thrown away. */
export function cancelVoiceCapture(): void {
  ExpoSpeechRecognitionModule.stop();
}
