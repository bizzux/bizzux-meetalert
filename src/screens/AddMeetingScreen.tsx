import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Svg, { Path, Line, Circle, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import {
  format,
  addMinutes,
  addDays,
  addMonths,
  setHours,
  setMinutes,
  setDay,
  startOfDay,
  differenceInMinutes,
} from 'date-fns';
import { upsertMeeting } from '../db/database';
import { scheduleMeeting, cancelForEdit } from '../services/reminderEngine';
import { confirmDeleteMeeting } from '../services/meetingActions';
import { captureMeetingSnapshot } from '../services/screenshotImport';
import { captureVoiceText, cancelVoiceCapture } from '../services/voiceInput';
import { showAlert } from '../services/appAlert';
import { Meeting, ReminderOffsetMinutes, RepeatOption, RecurrenceEndOption } from '../types';
import { useThemeColors } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';
import PillGroup from '../components/Pill';
import GradientButton from '../components/GradientButton';

// The "How often" row, shown once "Repeats" is picked on the toggle above
// it — every RepeatOption except 'none', which that toggle covers instead.
// "Recurring" is relabeled "Custom days" here, since that's what it
// actually does: pick your own weekdays below, rather than one of the
// fixed interval presets.
const REPEAT_PATTERN_OPTIONS: { label: string; value: RepeatOption }[] = [
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekends', value: 'weekends' },
  { label: 'Bi-weekly', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Custom days', value: 'recurring' },
];

// Mon-first order to match how the user described it (Mon, Tue, Wed…);
// `value` is JS's native Date#getDay() convention (0 = Sunday).
const DAY_OPTIONS: { label: string; value: number }[] = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

// Outlook-style "Range of recurrence" — how long the series runs for. Paired
// with MAX_OCCURRENCES below as a hard safety cap either way.
const RECURRENCE_END_OPTIONS: { label: string; value: RecurrenceEndOption }[] = [
  { label: '2 weeks', value: '2w' },
  { label: '1 month', value: '1m' },
  { label: '3 months', value: '3m' },
  { label: '6 months', value: '6m' },
  { label: 'Custom range', value: 'custom' },
];

// Hard cap on how many occurrences a single "Repeat" choice can generate,
// regardless of frequency or the "Ends" range picked. Previously a Daily
// series alone could generate up to 60 occurrences, each scheduling up to
// ~14 native alarm/reminder calls — 800+ native calls fired in one save,
// which is the root cause behind saves silently failing to return to Home
// and the app becoming unstable afterwards. 24 occurrences keeps a single
// save well within safe territory while still covering weeks of a daily
// series or months of a weekly/monthly one.
const MAX_OCCURRENCES = 24;

const REMINDER_OPTIONS: { label: string; value: ReminderOffsetMinutes }[] = [
  { label: '30 min', value: 30 },
  { label: '15 min', value: 15 },
  { label: '5 min', value: 5 },
  { label: '2 min', value: 2 },
];

// The "Duration" quick-picks on the What & when card — an optional faster
// way to set End time (Start time + this many minutes) than opening its
// picker. End time's own picker still works exactly as before; this is
// purely an extra shortcut, never the only way to set it.
const DURATION_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '1 hr' },
  { minutes: 90, label: '1.5 hr' },
];

type CardKey = 'repeat' | 'remind' | 'details';

/** Plain outline microphone for the quick-add field's voice button, teal to
 * match the app's brand accent (colors.secondary) instead of the old
 * Google-colored dot cluster. */
function MicIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <Line x1={12} y1={19} x2={12} y2={23} />
      <Line x1={8} y1={23} x2={16} y2={23} />
    </Svg>
  );
}

/** Pencil/edit glyph for the quick-add row's "Fill in" button, so all three
 * actions (Fill in / Voice / Snap) read as the same family of icon-led
 * buttons instead of "Fill in" being bare text next to two icon buttons. */
function PencilIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

/** Plain outline camera for the quick-add row's "Snap" button — the same
 * capture used to live behind its own full-width "Take Snapshot to
 * auto-fill" button between Title and Date; it now lives here instead. */
function CameraIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <Circle cx={12} cy={13} r={3.5} />
    </Svg>
  );
}

/** Small calendar glyph for the "Ends on ..." custom-range button, so it
 * reads as a tappable date field (opens a calendar) rather than plain
 * static text next to a border. */
function CalendarIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3.5} y={5} width={17} height={16} rx={2.5} />
      <Path d="M3.5 10h17" />
      <Path d="M8 3v4" />
      <Path d="M16 3v4" />
    </Svg>
  );
}

export default function AddMeetingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const reminderOffsets = useSettingsStore((s) => s.reminderOffsets);
  const toggleReminderOffset = useSettingsStore((s) => s.toggleReminderOffset);
  const requireConfirmation = useSettingsStore((s) => s.requireConfirmation);
  const setRequireConfirmation = useSettingsStore((s) => s.setRequireConfirmation);

  // Lets the bottom tab bar's Add button show its gradient circle only
  // while this screen is actually the one on top (see store/uiStore.ts) —
  // set on focus, cleared on blur/unmount, so it can't get stuck on.
  const setAddMeetingOpen = useUiStore((s) => s.setAddMeetingOpen);
  useFocusEffect(
    useCallback(() => {
      setAddMeetingOpen(true);
      return () => setAddMeetingOpen(false);
    }, [setAddMeetingOpen])
  );

  const editingMeeting: Meeting | undefined = route.params?.meeting;
  const isEditing = !!editingMeeting;

  const [title, setTitle] = useState(editingMeeting?.title ?? '');
  // startTime carries the full date+time — the Date field below edits just
  // its date part (via composeDateTime), and the Start time field edits
  // just its time part, but this one Date value stays the single source of
  // truth. endTime only ever contributes its time-of-day: composeDateTime()
  // always pairs it with startTime's date at save time.
  const [startTime, setStartTime] = useState<Date>(
    editingMeeting ? new Date(editingMeeting.startTime) : roundToNext5Minutes(new Date())
  );
  const [endTime, setEndTime] = useState<Date>(
    editingMeeting ? new Date(editingMeeting.endTime) : addMinutes(roundToNext5Minutes(new Date()), 45)
  );
  const [link, setLink] = useState(editingMeeting?.meetingLink ?? '');
  const [organizer, setOrganizer] = useState(editingMeeting?.organizer ?? '');
  const [notes, setNotes] = useState(editingMeeting?.notes ?? '');
  // Recurring is the default, per how most of this app's meetings are used.
  const [repeat, setRepeat] = useState<RepeatOption>('recurring');
  const [endsOption, setEndsOption] = useState<RecurrenceEndOption>('1m');
  // Only used when endsOption === 'custom' — the explicit end date of the
  // series, picked directly instead of one of the fixed 2w/1m/3m/6m presets.
  const [customEndDate, setCustomEndDate] = useState<Date>(addMonths(new Date(), 1));
  const [showCustomEndPicker, setShowCustomEndPicker] = useState(false);
  // Which weekdays a "Recurring" series repeats on — defaults to today's
  // weekday so it's usable the moment "Recurring" is picked, without
  // forcing an extra tap first.
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([new Date().getDay()]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [listening, setListening] = useState(false);

  // Which of the three optional cards below are open — What & when isn't
  // one of these (it's always shown, not collapsible). Repeat starts open
  // too, since Recurring is now the default rather than an opt-in extra;
  // Reminders/Details still start collapsed, keeping the common case a
  // shorter screen instead of one long scroll of every field at once. Each
  // collapsed card still shows a live summary of what's set inside it (see
  // the *Summary() helpers below), so nothing is hidden, just tucked away.
  const [expanded, setExpanded] = useState<Record<CardKey, boolean>>({
    repeat: true,
    remind: false,
    details: false,
  });
  const toggleCard = (key: CardKey) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // The free-text box on What & when — "Standup tomorrow 9am for 30 min" —
  // a typed sibling to Take Snapshot's photo-based fill. Same idea (fills
  // Title/Start/End so there's less to type by hand), different input.
  const [quickText, setQuickText] = useState('');

  // Date field — mode="date", so `selected` only carries a new date, never
  // a new time of day. Keeps startTime's existing time-of-day and just
  // moves it onto the new date.
  const onChangeDate = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) setStartTime((prev) => composeDateTime(selected, prev));
  };

  // Start time field — mode="time", so `selected` only carries a new time
  // of day (typically stamped with today's date by the native picker,
  // which is why it's composed back onto startTime's existing date rather
  // than used directly).
  const onChangeStart = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selected) {
      const next = composeDateTime(startTime, selected);
      setStartTime(next);
      if (next >= composeDateTime(startTime, endTime)) {
        setEndTime(addMinutes(next, 30));
      }
    }
  };

  const onChangeEnd = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (selected) setEndTime(selected);
  };

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev; // always keep at least one day selected
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort();
    });
  };

  const onChangeCustomEnd = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowCustomEndPicker(Platform.OS === 'ios');
    if (selected) setCustomEndDate(selected);
  };

  // "Take snapshot" — opens the camera, OCRs + parses the photo, and fills
  // in whatever fields it could read (never clobbering a field the person
  // already typed something into) so they can review before saving.
  const onCaptureSnapshot = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const parsed = await captureMeetingSnapshot();
      if (!parsed) return;

      if (parsed.title && !title.trim()) setTitle(parsed.title);
      if (parsed.startTime) {
        setStartTime(parsed.startTime);
        setEndTime(parsed.endTime ?? addMinutes(parsed.startTime, 30));
      }
      if (parsed.link && !link.trim()) setLink(parsed.link);

      showAlert('Filled from photo', 'Double-check the details below, then save.');
    } finally {
      setCapturing(false);
    }
  };

  // Shared by the typed "Fill in" button and the mic button below — both
  // just get a raw phrase from the person one way or another and need the
  // exact same parse-then-fill treatment applied to it.
  const applyQuickAddText = (text: string, source: string) => {
    const parsed = parseQuickAdd(text, startTime);
    if (!parsed) {
      // No recognizable day/time in it — rather than reject the tap
      // outright (which read as the button "not working" for anything
      // typed without those keywords), fall back to using the raw text as
      // the title. Still doesn't guess at a date/time it isn't sure of.
      if (text.trim()) {
        setTitle(text.trim());
        setQuickText('');
        showAlert(`Filled in from your ${source}`, "Added it as the title. Set a day and time below when you're ready.");
      }
      return;
    }
    setTitle(parsed.title);
    if (parsed.startTime) {
      setStartTime(parsed.startTime);
      setEndTime(parsed.endTime ?? addMinutes(parsed.startTime, 45));
    } else if (parsed.date) {
      // Only a date was said (no time) — keep whatever time of day was
      // already picked, just move it onto the new date.
      setStartTime((prev) => composeDateTime(parsed.date!, prev));
    }
    setQuickText('');
    showAlert(`Filled in from your ${source}`, 'Double-check the details below, then save.');
  };

  // "Fill in" — parses whatever's typed in the quick-add box. An explicit
  // one-tap action, so it's fine to overwrite whatever was there before
  // (that's the point of using it).
  const onQuickFill = () => {
    if (!quickText.trim()) {
      // Nothing typed yet. This used to be a silent no-op, which reads as
      // "the button doesn't work" if you tap it straight away (e.g. after
      // just reading the grayed-out placeholder example, which isn't real
      // typed text) — say so instead of doing nothing visible.
      showAlert('Type something first', 'Type or say a quick description, then tap Fill in.');
      return;
    }
    applyQuickAddText(quickText, 'note');
  };

  // The mic button next to "Fill in" — same idea, spoken instead of typed.
  // Records one phrase, then runs it through the exact same parser as the
  // text box so "say it or type it" behave identically once the words are
  // in hand.
  const onVoiceInput = async () => {
    if (listening) return;
    setListening(true);
    try {
      const transcript = await captureVoiceText();
      if (!transcript) return; // permission denied, nothing heard, or recognition failed — fail quietly, same as Take Snapshot finding nothing
      setQuickText(transcript);
      applyQuickAddText(transcript, 'voice note');
    } finally {
      setListening(false);
    }
  };

  const onSave = async () => {
    if (saving) return; // guards against a double-tap firing two save runs
    setError('');
    if (!title.trim()) {
      setError('Give the meeting a title.');
      return;
    }
    const start = startTime;
    const end = composeDateTime(startTime, endTime);
    if (end <= start) {
      setError('End time must be after start time.');
      return;
    }

    setSaving(true);
    try {
      if (isEditing) {
        const meeting: Meeting = {
          ...editingMeeting!,
          title: title.trim(),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          meetingLink: link.trim() || null,
          organizer: organizer.trim() || null,
          notes: notes.trim() || null,
        };
        // Times may have changed — clear the old reminders/alarm before
        // scheduling fresh ones so the meeting doesn't ring on its old time.
        await cancelForEdit(meeting.id);
        upsertMeeting(meeting);
        await scheduleMeeting(meeting);
        return;
      }

      const occurrences = buildOccurrences(start, end, repeat, endsOption, daysOfWeek, customEndDate);
      const recurrenceId = occurrences.length > 1 ? `rec-${Date.now()}` : null;

      const meetings: Meeting[] = occurrences.map((occ) => ({
        id: `manual-${occ.start.getTime()}`,
        title: title.trim(),
        startTime: occ.start.toISOString(),
        endTime: occ.end.toISOString(),
        source: 'manual',
        meetingLink: link.trim() || null,
        organizer: organizer.trim() || null,
        notes: notes.trim() || null,
        recurrenceId,
      }));

      // Save every occurrence to the DB first (fast, synchronous, can't
      // fail from a native call) so the meetings are already there even if
      // scheduling below runs slowly or partially fails.
      meetings.forEach(upsertMeeting);
      // Then schedule reminders/alarms for all of them concurrently —
      // scheduleMeeting() already catches its own errors per meeting, so
      // one occurrence's native scheduling failing can't stop the others
      // or stop this screen from returning to Home.
      await Promise.all(meetings.map((meeting) => scheduleMeeting(meeting)));
    } catch (err) {
      // Belt-and-braces: even though upsertMeeting/scheduleMeeting are
      // guarded above, never let a save fail silently by leaving the user
      // stuck on this screen — the meeting(s) are saved either way since
      // that DB write happens before scheduling.
      console.warn('[BizzMinder] save failed', err);
    } finally {
      setSaving(false);
      // Always return to Home — a save that's already in the database
      // should never leave the user stranded on this screen, and Home
      // reloads its list on focus so the new/updated meeting shows up
      // immediately without a manual refresh.
      navigation.goBack();
    }
  };

  const onDelete = () => {
    if (!editingMeeting) return;
    confirmDeleteMeeting(editingMeeting, () => navigation.goBack());
  };

  const selectedDuration = differenceInMinutes(endTime, startTime);

  // The exact meetings a Repeat choice will create — computed the same way
  // Save itself builds them, so the note below always matches what
  // actually gets saved instead of a generic cap that may not even be
  // reachable (e.g. a 2-week range can never fit close to MAX_OCCURRENCES
  // meetings in it).
  const previewOccurrences =
    repeat === 'none' ? [] : buildOccurrences(startTime, composeDateTime(startTime, endTime), repeat, endsOption, daysOfWeek, customEndDate);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
    >
      {!isEditing && (
        <View style={[styles.quickFillBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <View style={styles.quickFillHeader}>
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Path d="M12 2l1.8 5.6L19.4 9l-5.6 1.8L12 16l-1.8-5.2L5 9l5.2-1.4z" fill={colors.secondary} />
            </Svg>
            <Text style={[styles.quickFillTitle, { color: colors.secondary }]}>Quick add</Text>
          </View>
          <Text style={[styles.quickFillFieldLabel, { color: colors.textMuted }]}>What's the meeting?</Text>
          {/* Its own bordered pill, in a color distinct from the card behind
              it, with a dimmer placeholder than typed text — so this reads
              as a tappable field at a glance, not just more label text. */}
          <View style={[styles.quickFillFieldRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              style={[styles.quickFillInput, { flex: 1, color: colors.textPrimary }]}
              value={quickText}
              onChangeText={setQuickText}
              editable={!listening}
              placeholder={listening ? 'Listening…' : 'Standup tomorrow 9am'}
              placeholderTextColor={`${colors.textMuted}73`}
              onSubmitEditing={onQuickFill}
              returnKeyType="done"
              numberOfLines={1}
              ellipsizeMode="tail"
            />
          </View>

          {/* Fill in / Voice / Snap — three equal, identically styled
              actions (same brand gradient, icon stacked above label)
              instead of one primary button plus two smaller ones, so
              nothing here reads as the "real" way to fill this in over the
              others: type it, say it, or snap a photo, whichever's easiest
              right now. Snap replaces the standalone "Take Snapshot to
              auto-fill" button that used to sit between Title and Date —
              same capture, just reachable from here instead. */}
          <View style={styles.quickActionRow}>
            <TouchableOpacity
              onPress={onQuickFill}
              disabled={listening}
              style={[styles.quickActionButton, { opacity: listening ? 0.5 : 1 }]}
            >
              <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.quickActionGradient}>
                <PencilIcon size={18} color={colors.white} />
                <Text style={styles.quickActionLabel}>Fill in</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={listening ? cancelVoiceCapture : onVoiceInput} style={styles.quickActionButton}>
              {listening ? (
                <View style={[styles.quickActionGradient, { backgroundColor: colors.danger }]}>
                  <Text style={styles.quickActionListeningDot}>●</Text>
                  <Text style={styles.quickActionLabel}>Stop</Text>
                </View>
              ) : (
                <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.quickActionGradient}>
                  <MicIcon size={18} color={colors.white} />
                  <Text style={styles.quickActionLabel}>Voice</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onCaptureSnapshot}
              disabled={capturing || listening}
              style={[styles.quickActionButton, { opacity: capturing || listening ? 0.5 : 1 }]}
            >
              <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.quickActionGradient}>
                <CameraIcon size={18} color={colors.white} />
                <Text style={styles.quickActionLabel}>{capturing ? 'Reading…' : 'Snap'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <Text style={[styles.quickFillHint, { color: colors.textMuted }]}>
            {listening
              ? 'Listening… speak the meeting (title, day and time), or tap Stop.'
              : "Type it, say it, or snap a photo. We'll fill in the details."}
          </Text>
        </View>
      )}

      <View style={[styles.plainCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>Title</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Weekly sync"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Date</Text>
        <TouchableOpacity
          style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => setShowDatePicker(true)}
        >
          <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>
            {format(startTime, 'EEE, d MMM yyyy')}
          </Text>
        </TouchableOpacity>
        {showDatePicker && (
          <DateTimePicker value={startTime} mode="date" display="default" onChange={onChangeDate} />
        )}

        <View style={styles.timeRow}>
          <View style={styles.timeRowField}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Start time</Text>
            <TouchableOpacity
              style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setShowStartPicker(true)}
            >
              <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>{format(startTime, 'h:mm a')}</Text>
            </TouchableOpacity>
            {showStartPicker && (
              <DateTimePicker value={startTime} mode="time" display="default" onChange={onChangeStart} />
            )}
          </View>

          <View style={styles.timeRowField}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>End time</Text>
            <TouchableOpacity
              style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => setShowEndPicker(true)}
            >
              <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>{format(endTime, 'h:mm a')}</Text>
            </TouchableOpacity>
            {showEndPicker && (
              <DateTimePicker value={endTime} mode="time" display="default" onChange={onChangeEnd} />
            )}
          </View>
        </View>

        <Text style={[styles.label, { color: colors.textSecondary }]}>Duration</Text>
        <View style={styles.durationRow}>
          {DURATION_OPTIONS.map((opt) => {
            const isSelected = selectedDuration === opt.minutes;
            return (
              <TouchableOpacity
                key={opt.minutes}
                onPress={() => setEndTime(addMinutes(startTime, opt.minutes))}
                style={[
                  styles.durationChip,
                  {
                    backgroundColor: isSelected ? colors.primary : 'transparent',
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={{ color: isSelected ? colors.textOnPrimary : colors.textSecondary, fontWeight: '700', fontSize: 12.5 }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.durationHint, { color: colors.textMuted }]}>
          You can still open the End time picker directly. This is just a quicker way to set it.
        </Text>
      </View>

      {!isEditing && (
        <SectionCard
          title="Repeat"
          summary={repeatSummary(repeat, daysOfWeek, endsOption, startTime, customEndDate)}
          expanded={expanded.repeat}
          onToggle={() => toggleCard('repeat')}
          colors={colors}
        >
          {/* First decision: does this repeat at all. A plain two-way
              toggle instead of folding "Does not repeat" into a six-pill
              grid alongside interval presets like "Bi-weekly" — those
              aren't equally weighted choices, so they shouldn't look it. */}
          <RepeatToggle
            repeats={repeat !== 'none'}
            onChange={(repeats) => setRepeat(repeats ? 'recurring' : 'none')}
            colors={colors}
          />

          {repeat !== 'none' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>How often</Text>
              <PillGroup options={REPEAT_PATTERN_OPTIONS} selected={[repeat]} onToggle={(v) => setRepeat(v)} />
            </>
          )}

          {repeat === 'recurring' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Repeats on</Text>
              {/* A plain row, not a horizontal scroll — each chip is
                  flex: 1, so all seven always divide the card's width
                  evenly and fit, instead of a fixed-width chip getting cut
                  off at the edge on a narrower screen. */}
              <View style={styles.dayRow}>
                {DAY_OPTIONS.map((d) => {
                  const isSelected = daysOfWeek.includes(d.value);
                  return (
                    <TouchableOpacity
                      key={d.value}
                      onPress={() => toggleDay(d.value)}
                      style={[
                        styles.dayChip,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surfaceAlt,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        style={{ color: isSelected ? colors.textOnPrimary : colors.textSecondary, fontWeight: '700', fontSize: 10.5 }}
                      >
                        {d.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {repeat !== 'none' && (
            <View style={[styles.recurrenceRange, { borderTopColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>Ends</Text>
              <PillGroup
                options={RECURRENCE_END_OPTIONS}
                selected={[endsOption]}
                onToggle={(v) => setEndsOption(v)}
                tone="secondary"
              />
              {endsOption === 'custom' && (
                <TouchableOpacity
                  style={[
                    styles.pickerButton,
                    styles.pickerButtonRow,
                    { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10 },
                  ]}
                  onPress={() => setShowCustomEndPicker(true)}
                >
                  <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>
                    Ends on {format(customEndDate, 'EEE, d MMM yyyy')}
                  </Text>
                  <CalendarIcon size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {showCustomEndPicker && (
                <DateTimePicker
                  value={customEndDate}
                  mode="date"
                  minimumDate={startTime}
                  display="default"
                  onChange={onChangeCustomEnd}
                />
              )}
              {previewOccurrences.length > 0 && (
                <Text style={[styles.repeatNote, { color: colors.textMuted }]}>
                  This creates {previewOccurrences.length} meeting{previewOccurrences.length === 1 ? '' : 's'}, from{' '}
                  {format(previewOccurrences[0].start, 'd MMM')} to{' '}
                  {format(previewOccurrences[previewOccurrences.length - 1].start, 'd MMM yyyy')}. Each one gets its
                  own reminders, and you can delete just one or the whole series anytime.
                </Text>
              )}
            </View>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Reminders"
        summary={remindersSummary(reminderOffsets, requireConfirmation)}
        expanded={expanded.remind}
        onToggle={() => toggleCard('remind')}
        colors={colors}
      >
        <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>Remind me before</Text>
        <PillGroup
          options={REMINDER_OPTIONS}
          selected={reminderOffsets}
          onToggle={toggleReminderOffset}
        />

        <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Require confirmation to stop alarm</Text>
          <Switch value={requireConfirmation} onValueChange={setRequireConfirmation} colors={colors} />
        </View>
      </SectionCard>

      <SectionCard
        title="Details"
        summary={detailsSummary(link, organizer, notes)}
        expanded={expanded.details}
        onToggle={() => toggleCard('details')}
        colors={colors}
      >
        <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>Meeting link (optional)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
          value={link}
          onChangeText={setLink}
          placeholder="https://teams.microsoft.com/..."
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="url"
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Meeting organiser (optional)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
          value={organizer}
          onChangeText={setOrganizer}
          placeholder="Who's running this meeting"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Notes (optional)</Text>
        <TextInput
          style={[
            styles.input,
            styles.notesInput,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary },
          ]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Agenda, prep, or anything to remember for this meeting"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.sourceInfoRow}>
          <Text style={{ color: colors.textMuted, fontWeight: '600', fontSize: 12.5 }}>Calendar source</Text>
          <Text style={{ color: colors.textSecondary, fontWeight: '700', fontSize: 12.5 }}>Manual</Text>
        </View>
      </SectionCard>

      {!!error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

      <GradientButton
        label={isEditing ? 'Save changes' : 'Save meeting'}
        onPress={onSave}
        loading={saving}
        style={{ marginTop: 24 }}
      />

      {isEditing && (
        <TouchableOpacity onPress={onDelete} style={{ marginTop: 16 }}>
          <Text style={[styles.deleteLink, { color: colors.danger }]}>Delete this meeting</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

/**
 * A collapsible section — the four cards (What & when / Repeat / Reminders /
 * Details) that replaced one long flat scroll of every field at once.
 * `summary` renders next to the chevron when collapsed, so a card that's
 * closed still tells you what's set inside it instead of hiding it outright.
 */
function SectionCard({
  title,
  summary,
  expanded,
  onToggle,
  colors,
  children,
}: {
  title: string;
  summary?: string;
  expanded: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useThemeColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity onPress={onToggle} style={styles.cardHeader} accessibilityRole="button">
        <Text style={[styles.cardHeaderTitle, { color: colors.textPrimary }]}>{title}</Text>
        <View style={styles.cardHeaderRight}>
          {!!summary && (
            <Text style={[styles.cardHeaderSummary, { color: colors.textMuted }]} numberOfLines={1}>
              {summary}
            </Text>
          )}
          <Text
            style={[
              styles.cardChevron,
              { color: colors.textMuted },
              expanded && styles.cardChevronOpen,
            ]}
          >
            ›
          </Text>
        </View>
      </TouchableOpacity>
      {expanded && <View style={styles.cardBody}>{children}</View>}
    </View>
  );
}

/** The Repeat card's first decision, "Does not repeat" vs "Repeats" — a
 * plain two-way toggle rather than one more pill in the "How often" row, so
 * it reads as the question it actually is instead of a seventh option. */
function RepeatToggle({
  repeats,
  onChange,
  colors,
}: {
  repeats: boolean;
  onChange: (repeats: boolean) => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={[repeatToggleStyles.track, { backgroundColor: colors.surfaceAlt }]}>
      <TouchableOpacity
        onPress={() => onChange(false)}
        style={[repeatToggleStyles.half, !repeats && { backgroundColor: colors.primary }]}
      >
        <Text
          style={[
            repeatToggleStyles.label,
            { color: !repeats ? colors.textOnPrimary : colors.textSecondary, fontWeight: !repeats ? '700' : '600' },
          ]}
        >
          Does not repeat
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onChange(true)}
        style={[repeatToggleStyles.half, repeats && { backgroundColor: colors.primary }]}
      >
        <Text
          style={[
            repeatToggleStyles.label,
            { color: repeats ? colors.textOnPrimary : colors.textSecondary, fontWeight: repeats ? '700' : '600' },
          ]}
        >
          Repeats
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Tiny built-in switch so we don't need to theme RN's native Switch per platform. */
function Switch({ value, onValueChange, colors }: { value: boolean; onValueChange: (v: boolean) => void; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <TouchableOpacity
      onPress={() => onValueChange(!value)}
      style={[
        switchStyles.track,
        { backgroundColor: value ? colors.primary : colors.border },
      ]}
    >
      <View style={[switchStyles.thumb, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
    </TouchableOpacity>
  );
}

/** The last date a recurring series can produce an occurrence on — the
 * Outlook-style "Ends" choice on Add Meeting. `customEndDate` is only used
 * (and only needs to be passed) when option === 'custom'. */
function recurrenceEndDate(start: Date, option: RecurrenceEndOption, customEndDate?: Date): Date {
  switch (option) {
    case '2w':
      return addDays(start, 14);
    case '1m':
      return addMonths(start, 1);
    case '3m':
      return addMonths(start, 3);
    case '6m':
      return addMonths(start, 6);
    case 'custom':
      return customEndDate ?? addMonths(start, 1);
  }
}

/** The Repeat card's collapsed summary — live, so "Does not repeat" only
 * shows when that's actually still true, rather than being a static label
 * that stops matching the moment something is picked. */
function repeatSummary(
  repeat: RepeatOption,
  daysOfWeek: number[],
  endsOption: RecurrenceEndOption,
  startDate: Date,
  customEndDate: Date
): string {
  if (repeat === 'none') return 'Does not repeat';
  const endsLabel = format(recurrenceEndDate(startDate, endsOption, customEndDate), 'd MMM');
  if (repeat === 'weekdays') return `Weekdays · ends ${endsLabel}`;
  if (repeat === 'weekends') return `Weekends · ends ${endsLabel}`;
  if (repeat === 'biweekly') return `Bi-weekly · ends ${endsLabel}`;
  if (repeat === 'monthly') return `Monthly · ends ${endsLabel}`;
  const dayLabels = DAY_OPTIONS.filter((d) => daysOfWeek.includes(d.value)).map((d) => d.label);
  return `${dayLabels.join(', ')} · ends ${endsLabel}`;
}

/** The Reminders card's collapsed summary. */
function remindersSummary(offsets: ReminderOffsetMinutes[], requireConfirmation: boolean): string {
  const sorted = [...offsets].sort((a, b) => b - a);
  const offsetsLabel = sorted.length ? `${sorted.join(', ')} min` : 'No reminders set';
  return `${offsetsLabel} · ${requireConfirmation ? 'confirm required' : 'no confirmation'}`;
}

/** The Details card's collapsed summary — names whichever of the three
 * optional fields actually have something in them, so the card hints at
 * its own contents instead of always showing the same generic caption. */
function detailsSummary(link: string, organizer: string, notes: string): string {
  const filled: string[] = [];
  if (link.trim()) filled.push('Link');
  if (organizer.trim()) filled.push('Organiser');
  if (notes.trim()) filled.push('Notes');
  if (filled.length === 0) return 'Link, organiser, notes';
  return `${filled.join(', ')} added`;
}

/** Expands a single start/end + Repeat choice into the list of occurrence
 * date pairs to create, bounded by the "Ends" range and, regardless of
 * that range, by MAX_OCCURRENCES — so a single save can never schedule an
 * unbounded (or just very large) number of alarms.
 *
 * Weekdays / Weekends / Recurring are all "does this date's weekday match a
 * set of days?" — Weekdays and Weekends use a fixed set, Recurring uses
 * whatever the user picked in the day-of-week chips. Bi-weekly and Monthly
 * are interval-based instead (every 14 days / same date each month) and
 * don't involve a day-of-week set at all. */
function buildOccurrences(
  start: Date,
  end: Date,
  repeat: RepeatOption,
  endsOption: RecurrenceEndOption,
  daysOfWeek: number[],
  customEndDate?: Date
): { start: Date; end: Date }[] {
  const durationMs = end.getTime() - start.getTime();
  const withDuration = (s: Date) => ({ start: s, end: new Date(s.getTime() + durationMs) });

  if (repeat === 'none') return [withDuration(start)];

  const rangeEnd = recurrenceEndDate(start, endsOption, customEndDate);
  const results: { start: Date; end: Date }[] = [];

  if (repeat === 'monthly') {
    for (let i = 0; results.length < MAX_OCCURRENCES; i++) {
      const candidate = addMonths(start, i);
      if (candidate > rangeEnd) break;
      results.push(withDuration(candidate));
    }
  } else if (repeat === 'biweekly') {
    for (let i = 0; results.length < MAX_OCCURRENCES; i++) {
      const candidate = addDays(start, i * 14);
      if (candidate > rangeEnd) break;
      results.push(withDuration(candidate));
    }
  } else {
    const activeDays = repeat === 'weekdays' ? [1, 2, 3, 4, 5] : repeat === 'weekends' ? [0, 6] : daysOfWeek;
    for (let i = 0; results.length < MAX_OCCURRENCES; i++) {
      const candidate = addDays(start, i);
      if (candidate > rangeEnd) break;
      if (activeDays.includes(candidate.getDay())) results.push(withDuration(candidate));
    }
  }

  return results.length ? results : [withDuration(start)];
}

function composeDateTime(dateOnly: Date, timeOfDay: Date): Date {
  return setMinutes(setHours(dateOnly, timeOfDay.getHours()), timeOfDay.getMinutes());
}

function roundToNext5Minutes(date: Date): Date {
  const rounded = new Date(date);
  const remainder = 5 - (rounded.getMinutes() % 5);
  rounded.setMinutes(rounded.getMinutes() + (remainder === 5 ? 0 : remainder), 0, 0);
  return rounded;
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Turns a 12-hour "9", "am"/"pm" pair into a 24-hour hour number. */
function to24Hour(hour12: number, period: string): number {
  const isPM = period.toLowerCase() === 'pm';
  let h = hour12 % 12;
  if (isPM) h += 12;
  return h;
}

/**
 * The quick-add box's parser — deliberately modest, not a general NLP date
 * parser: it looks for one of "today"/"tomorrow"/a weekday name, one of a
 * time ("9am"), a time range ("2pm to 3pm") or a duration ("for 30 min"),
 * and treats whatever text is left over (with the matched phrases removed)
 * as the title. Returns null when it can't find at least a usable time or
 * date, so the caller can ask the person to rephrase rather than silently
 * filling in something wrong — a bad guess here is worse than no guess.
 */
function parseQuickAdd(
  raw: string,
  today: Date
): { title: string; date?: Date; startTime?: Date; endTime?: Date } | null {
  const text = raw.trim();
  if (!text) return null;
  let remainder = text;

  // Date: today / tomorrow / an optional "next" + weekday name.
  let resultDate: Date | undefined;
  if (/\btomorrow\b/i.test(remainder)) {
    resultDate = addDays(today, 1);
    remainder = remainder.replace(/\btomorrow\b/i, ' ');
  } else if (/\btoday\b/i.test(remainder)) {
    resultDate = today;
    remainder = remainder.replace(/\btoday\b/i, ' ');
  } else {
    const weekdayMatch = remainder.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (weekdayMatch) {
      const dayIndex = WEEKDAY_NAMES.indexOf(weekdayMatch[1].toLowerCase());
      let candidate = setDay(today, dayIndex, { weekStartsOn: 0 });
      const saysNext = /^next\s+/i.test(weekdayMatch[0]);
      if (startOfDay(candidate) < startOfDay(today) || saysNext) candidate = addDays(candidate, 7);
      resultDate = candidate;
      remainder = remainder.replace(weekdayMatch[0], ' ');
    }
  }

  // Duration: "for 30 min", "for 45 minutes", "for 1 hour", "for 1.5 hours".
  let durationMinutes: number | undefined;
  const durationMatch = remainder.match(/\bfor\s+(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|h(?:ou)?rs?)\b/i);
  if (durationMatch) {
    const n = parseFloat(durationMatch[1]);
    durationMinutes = /^h/i.test(durationMatch[2]) ? Math.round(n * 60) : Math.round(n);
    remainder = remainder.replace(durationMatch[0], ' ');
  }

  // Time: a range ("2pm to 3pm") takes priority over a single time ("9am").
  let startH: number | undefined;
  let startM = 0;
  let endH: number | undefined;
  let endM = 0;
  const rangeMatch = remainder.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
  if (rangeMatch) {
    const period2 = rangeMatch[6];
    const period1 = rangeMatch[3] || period2;
    startH = to24Hour(parseInt(rangeMatch[1], 10), period1);
    startM = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
    endH = to24Hour(parseInt(rangeMatch[4], 10), period2);
    endM = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
    remainder = remainder.replace(rangeMatch[0], ' ');
  } else {
    const singleMatch = remainder.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (singleMatch) {
      startH = to24Hour(parseInt(singleMatch[1], 10), singleMatch[3]);
      startM = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
      remainder = remainder.replace(singleMatch[0], ' ');
    }
  }

  if (!resultDate && startH === undefined) return null;

  const title = remainder.replace(/\s{2,}/g, ' ').trim().replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  const baseDate = resultDate ?? today;

  let startTime: Date | undefined;
  let endTime: Date | undefined;
  if (startH !== undefined) {
    startTime = setMinutes(setHours(baseDate, startH), startM);
    if (endH !== undefined) {
      endTime = setMinutes(setHours(baseDate, endH), endM);
    } else if (durationMinutes !== undefined) {
      endTime = addMinutes(startTime, durationMinutes);
    }
  }

  return { title: title || 'New meeting', date: resultDate, startTime, endTime };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  label: { fontSize: 14, marginTop: 18, marginBottom: 8, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15 },
  notesInput: { minHeight: 90, paddingTop: 14 },
  pickerButton: { borderWidth: 1, borderRadius: 12, padding: 14 },
  pickerButtonText: { fontSize: 15 },
  // Only the custom-range "Ends on" button uses this — a trailing icon
  // next to the date text so it reads as tappable-to-open-a-calendar,
  // rather than plain text sitting inside a border.
  pickerButtonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row' },
  // Start time / End time side by side, below the Date field.
  timeRow: { flexDirection: 'row', gap: 12 },
  timeRowField: { flex: 1 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 20,
  },
  toggleLabel: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 12 },
  error: { marginTop: 16, fontSize: 14, fontWeight: '600' },
  deleteLink: { textAlign: 'center', fontSize: 14, fontWeight: '600' },
  // A plain top divider instead of its own filled, bordered box — that box
  // sat inside the Repeat card's own border, a box within a box, adding
  // chrome without adding information.
  recurrenceRange: { borderTopWidth: 1, paddingTop: 14, marginTop: 16 },
  repeatNote: { fontSize: 12.5, marginTop: 10, lineHeight: 17 },
  // No scrolling, no fixed pixel width: each chip is `flex: 1` so the row
  // always divides the card's actual available width evenly across all
  // seven days, whatever the screen size — instead of a fixed width that
  // could overflow a narrow phone or leave slack on a wider one.
  dayRow: { flexDirection: 'row', gap: 4 },
  dayChip: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Quick-fill box
  quickFillBox: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  quickFillHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quickFillTitle: { fontSize: 13, fontWeight: '700' },
  quickFillFieldLabel: { fontSize: 11, marginTop: 8 },
  quickFillFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  // Fixed height + overflow: 'hidden' stops long typed text or the example
  // placeholder from wrapping onto a second line and running behind the mic
  // button next to it — Android's TextInput can still wrap a single-line
  // input's text visually when the available width is narrow, even without
  // the `multiline` prop set, so height alone (no multiline) isn't enough;
  // clipping the overflow is what actually keeps it to one line.
  quickFillInput: { fontSize: 14, height: 20, paddingVertical: 0, overflow: 'hidden' },
  // Fill in / Voice / Snap — three equal-width actions, each its own
  // rounded gradient chip (see quickActionGradient) so all three read as
  // the same kind of button regardless of which one gets tapped.
  quickActionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  quickActionButton: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  quickActionGradient: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  quickActionLabel: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  quickActionListeningDot: { color: '#FFFFFF', fontSize: 16 },
  quickFillHint: { fontSize: 11, marginTop: 10, lineHeight: 15, textAlign: 'center' },

  // Duration chips
  durationRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  durationChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  durationHint: { fontSize: 11.5, marginTop: 8, lineHeight: 15 },

  // What & when — same bordered-card look as the collapsible ones below,
  // but always open and with no header/chevron, since it's the primary
  // section rather than an optional extra.
  plainCard: { borderWidth: 1, borderRadius: 14, marginBottom: 12, padding: 15 },

  // Collapsible cards
  card: { borderWidth: 1, borderRadius: 14, marginBottom: 12, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15 },
  cardHeaderTitle: { fontSize: 14.5, fontWeight: '700' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, marginLeft: 12 },
  cardHeaderSummary: { fontSize: 12.5, fontWeight: '500', flexShrink: 1 },
  cardChevron: { fontSize: 17, fontWeight: '700' },
  cardChevronOpen: { transform: [{ rotate: '90deg' }] },
  cardBody: { paddingHorizontal: 15, paddingBottom: 15 },

  sourceInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
});

const switchStyles = StyleSheet.create({
  track: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
});

const repeatToggleStyles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 8 },
  half: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  label: { fontSize: 13 },
});
