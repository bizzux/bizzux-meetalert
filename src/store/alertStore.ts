import { create } from 'zustand';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
  show: (title: string, message?: string, buttons?: AlertButton[]) => void;
  hide: () => void;
}

/**
 * Backs showAlert() (services/appAlert.ts) and AppAlertHost.tsx — together a
 * drop-in replacement for React Native's own Alert.alert. The native Alert
 * can't be restyled (no border radius, no theme colors), so every "pop up"
 * in the app — sync errors, delete confirmations, sign-out, etc. — now
 * renders through this one rounded-corner card instead, matching the rest
 * of BizzMinder's look on both platforms.
 */
export const useAlertStore = create<AlertState>((set) => ({
  visible: false,
  title: '',
  message: undefined,
  buttons: [{ text: 'OK' }],

  show: (title, message, buttons) =>
    set({
      visible: true,
      title,
      message,
      buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }],
    }),

  hide: () => set({ visible: false }),
}));
