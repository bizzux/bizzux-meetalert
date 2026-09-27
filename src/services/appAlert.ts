import { useAlertStore, AlertButton } from '../store/alertStore';

/**
 * Drop-in replacement for React Native's Alert.alert — same (title, message?,
 * buttons?) signature, same button style names ('cancel' | 'destructive'),
 * same "no buttons means a single OK" default — but renders through our own
 * rounded-corner card (AppAlertHost, mounted once in navigation/index.tsx)
 * instead of the platform's native dialog, which can't be restyled.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  useAlertStore.getState().show(title, message, buttons);
}
