// On-device text recognition (Google ML Kit, via @react-native-ml-kit) for
// the "Snap & Fill" screenshot-import feature. Runs entirely on the phone —
// no network call, no per-image cost, works offline.
import TextRecognition from '@react-native-ml-kit/text-recognition';

/** Runs OCR on a local image file and returns the recognized text as one
 * block, with line breaks preserved (ML Kit already groups lines sensibly
 * for a typed screenshot like an Outlook/Teams invite). */
export async function recognizeTextFromImage(uri: string): Promise<string> {
  const result = await TextRecognition.recognize(uri);
  return result?.text ?? '';
}
