// Voice capture for Add Meeting's quick-fill box — records a single spoken
// phrase and resolves with the transcript, or null if the mic permission
// was denied, nothing was understood, or recognition failed for any other
// reason. Mirrors captureMeetingSnapshot()'s "no result → caller just does
// nothing" contract, so AddMeetingScreen doesn't need special-case error UI
// for every possible mic/permission failure — it already has one for "text
// didn't parse" via parseQuickAdd(), which runs on whatever this returns.
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

export async function captureVoiceText(): Promise<string | null> {
  const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (!permission.granted) return null;

  return new Promise((resolve) => {
    let transcript = '';
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resultSub.remove();
      errorSub.remove();
      endSub.remove();
      resolve(value);
    };

    // Keep only the latest final-ish result — continuous:false means there's
    // only ever one utterance per call, so the last "result" event before
    // "end" is the one that matters.
    const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event) => {
      const best = event.results?.[0]?.transcript;
      if (best) transcript = best;
    });
    const errorSub = ExpoSpeechRecognitionModule.addListener('error', () => finish(null));
    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => finish(transcript.trim() || null));

    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: false,
      continuous: false,
    });
  });
}

/** Lets the screen cancel an in-progress capture (e.g. the user backs out
 * or taps the mic button again while it's listening). */
export function cancelVoiceCapture(): void {
  ExpoSpeechRecognitionModule.stop();
}
