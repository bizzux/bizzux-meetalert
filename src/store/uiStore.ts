import { create } from 'zustand';

interface UiState {
  /** True while AddMeetingScreen (add or edit) is the focused screen —
   * lets the bottom tab bar (navigation/index.tsx) show the Add button's
   * gradient circle only while that screen is actually open, the same
   * "active tab only, full gradient" rule the other three tabs follow.
   * The Add tab itself is never a real focused route in the Tab.Navigator
   * (its tabPress always redirects to the AddMeeting modal instead of
   * switching tabs — see CustomTabBar), so this flag is the only way the
   * tab bar can know the Add screen is currently showing. */
  addMeetingOpen: boolean;
  setAddMeetingOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  addMeetingOpen: false,
  setAddMeetingOpen: (open) => set({ addMeetingOpen: open }),
}));
