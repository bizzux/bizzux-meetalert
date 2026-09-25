import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, addMinutes, addDays, addMonths, setHours, setMinutes } from 'date-fns';
import { upsertMeeting, deleteMeeting, deleteRecurrenceSeries } from '../db/database';
import { scheduleMeeting, cancelForEdit } from '../services/reminderEngine';
import { Meeting, ReminderOffsetMinutes, RepeatOption, RecurrenceEndOption } from '../types';
import { useThemeColors } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import PillGroup from '../components/Pill';
import GradientButton from '../components/GradientButton';

const SOURCE_OPTIONS = [
  { label: 'Teams', value: 'teams' },
  { label: 'Outlook', value: 'outlook' },
  { label: 'Google', value: 'google' },
  { label: 'Local calendar', value: 'local' },
  { label: 'Manual', value: 'manual' },
] as const;

const REPEAT_OPTIONS: { label: string; value: RepeatOption }[] = [
  { label: 'Does not repeat', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekends', value: 'weekends' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Bi-weekly', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
];

// Outlook-style "Range of recurrence" — how long the series runs for. Paired
// with MAX_OCCURRENCES below as a hard safety cap either way.
const RECURRENCE_END_OPTIONS: { label: string; value: RecurrenceEndOption }[] = [
  { label: '2 weeks', value: '2w' },
  { label: '1 month', value: '1m' },
  { label: '3 months', value: '3m' },
  { label: '6 months', value: '6m' },
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

export default function AddMeetingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const reminderOffsets = useSettingsStore((s) => s.reminderOffsets);
  const toggleReminderOffset = useSettingsStore((s) => s.toggleReminderOffset);
  const requireConfirmation = useSettingsStore((s) => s.requireConfirmation);
  const setRequireConfirmation = useSettingsStore((s) => s.setRequireConfirmation);

  const editingMeeting: Meeting | undefined = route.params?.meeting;
  const isEditing = !!editingMeeting;

  const [title, setTitle] = useState(editingMeeting?.title ?? '');
  const [date, setDate] = useState<Date>(editingMeeting ? new Date(editingMeeting.startTime) : new Date());
  const [startTime, setStartTime] = useState<Date>(
    editingMeeting ? new Date(editingMeeting.startTime) : roundToNext5Minutes(new Date())
  );
  const [endTime, setEndTime] = useState<Date>(
    editingMeeting ? new Date(editingMeeting.endTime) : addMinutes(roundToNext5Minutes(new Date()), 45)
  );
  const [link, setLink] = useState(editingMeeting?.meetingLink ?? '');
  const [repeat, setRepeat] = useState<RepeatOption>('none');
  const [endsOption, setEndsOption] = useState<RecurrenceEndOption>('1m');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // This screen only ever creates a "manual" entry — Teams/Outlook/Local
  // calendar pills mirror the app's overall calendar-source settings for
  // context (they're synced automatically, not created here), so only
  // Manual is selectable.
  const source: (typeof SOURCE_OPTIONS)[number]['value'] = 'manual';

  const onChangeDate = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) setDate(selected);
  };

  const onChangeStart = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selected) {
      setStartTime(selected);
      if (composeDateTime(date, selected) >= composeDateTime(date, endTime)) {
        setEndTime(addMinutes(selected, 30));
      }
    }
  };

  const onChangeEnd = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowEndPicker(Platform.OS === 'ios');
    if (selected) setEndTime(selected);
  };

  const onSave = async () => {
    if (saving) return; // guards against a double-tap firing two save runs
    setError('');
    if (!title.trim()) {
      setError('Give the meeting a title.');
      return;
    }
    const start = composeDateTime(date, startTime);
    const end = composeDateTime(date, endTime);
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
        };
        // Times may have changed — clear the old reminders/alarm before
        // scheduling fresh ones so the meeting doesn't ring on its old time.
        await cancelForEdit(meeting.id);
        upsertMeeting(meeting);
        await scheduleMeeting(meeting);
        return;
      }

      const occurrences = buildOccurrences(start, end, repeat, endsOption);
      const recurrenceId = occurrences.length > 1 ? `rec-${Date.now()}` : null;

      const meetings: Meeting[] = occurrences.map((occ) => ({
        id: `manual-${occ.start.getTime()}`,
        title: title.trim(),
        startTime: occ.start.toISOString(),
        endTime: occ.end.toISOString(),
        source: 'manual',
        meetingLink: link.trim() || null,
        notes: null,
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
      console.warn('[MeetAlert] save failed', err);
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
    const isRecurring = !!editingMeeting.recurrenceId;
    const buttons = isRecurring
      ? [
          { text: 'Cancel', style: 'cancel' as const },
          {
            text: 'Just this one',
            onPress: async () => {
              await cancelForEdit(editingMeeting.id);
              deleteMeeting(editingMeeting.id);
              navigation.goBack();
            },
          },
          {
            text: 'Whole series',
            style: 'destructive' as const,
            onPress: async () => {
              await cancelForEdit(editingMeeting.id);
              deleteRecurrenceSeries(editingMeeting.recurrenceId!);
              navigation.goBack();
            },
          },
        ]
      : [
          { text: 'Cancel', style: 'cancel' as const },
          {
            text: 'Delete',
            style: 'destructive' as const,
            onPress: async () => {
              await cancelForEdit(editingMeeting.id);
              deleteMeeting(editingMeeting.id);
              navigation.goBack();
            },
          },
        ];
    Alert.alert('Delete meeting', `Remove "${editingMeeting.title}"?`, buttons);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>Meeting title</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
        value={title}
        onChangeText={setTitle}
        placeholder="Weekly sync"
        placeholderTextColor={colors.textMuted}
        autoFocus
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {!isEditing && repeat !== 'none' ? 'Start date' : 'Date'}
      </Text>
      <TouchableOpacity
        style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setShowDatePicker(true)}
      >
        <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>{format(date, 'EEE, d MMM yyyy')}</Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker value={date} mode="date" display="default" onChange={onChangeDate} />
      )}

      <View style={styles.row}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Start time</Text>
          <TouchableOpacity
            style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setShowStartPicker(true)}
          >
            <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>{format(startTime, 'h:mm a')}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>End time</Text>
          <TouchableOpacity
            style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setShowEndPicker(true)}
          >
            <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>{format(endTime, 'h:mm a')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {showStartPicker && (
        <DateTimePicker value={startTime} mode="time" display="default" onChange={onChangeStart} />
      )}
      {showEndPicker && (
        <DateTimePicker value={endTime} mode="time" display="default" onChange={onChangeEnd} />
      )}

      <Text style={[styles.label, { color: colors.textSecondary }]}>Calendar source</Text>
      <View style={styles.sourceRow}>
        {SOURCE_OPTIONS.map((opt) => {
          const isSelected = opt.value === source;
          const disabled = !isSelected;
          return (
            <TouchableOpacity
              key={opt.value}
              disabled={disabled}
              style={[
                styles.sourcePill,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surfaceAlt,
                  borderColor: isSelected ? colors.primary : colors.border,
                  opacity: disabled ? 0.5 : 1,
                },
              ]}
            >
              <Text style={{ color: isSelected ? colors.textOnPrimary : colors.textMuted, fontWeight: '600', fontSize: 13 }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {!isEditing && (
        <>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Repeat</Text>
          <PillGroup
            options={REPEAT_OPTIONS}
            selected={[repeat]}
            onToggle={(v) => setRepeat(v)}
          />

          {repeat !== 'none' && (
            <View style={[styles.recurrenceRange, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>Ends</Text>
              <PillGroup
                options={RECURRENCE_END_OPTIONS}
                selected={[endsOption]}
                onToggle={(v) => setEndsOption(v)}
                tone="secondary"
              />
              <Text style={[styles.repeatNote, { color: colors.textMuted }]}>
                Creates up to {MAX_OCCURRENCES} meetings between {format(date, 'd MMM')} and{' '}
                {format(recurrenceEndDate(date, endsOption), 'd MMM yyyy')}, each with its own reminders. You can
                delete just one occurrence or the whole series later from any of them.
              </Text>
            </View>
          )}
        </>
      )}

      <Text style={[styles.label, { color: colors.textSecondary }]}>Remind me before</Text>
      <PillGroup
        options={REMINDER_OPTIONS}
        selected={reminderOffsets}
        onToggle={toggleReminderOffset}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>Meeting link (optional)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
        value={link}
        onChangeText={setLink}
        placeholder="https://teams.microsoft.com/..."
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="url"
      />

      <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Require confirmation to stop alarm</Text>
        <Switch value={requireConfirmation} onValueChange={setRequireConfirmation} colors={colors} />
      </View>

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
 * Outlook-style "Ends" choice on Add Meeting. */
function recurrenceEndDate(start: Date, option: RecurrenceEndOption): Date {
  switch (option) {
    case '2w':
      return addDays(start, 14);
    case '1m':
      return addMonths(start, 1);
    case '3m':
      return addMonths(start, 3);
    case '6m':
      return addMonths(start, 6);
  }
}

/** Expands a single start/end + Repeat choice into the list of occurrence
 * date pairs to create, bounded by the "Ends" range and, regardless of
 * that range, by MAX_OCCURRENCES — so a single save can never schedule an
 * unbounded (or just very large) number of alarms. */
function buildOccurrences(
  start: Date,
  end: Date,
  repeat: RepeatOption,
  endsOption: RecurrenceEndOption
): { start: Date; end: Date }[] {
  const durationMs = end.getTime() - start.getTime();
  const withDuration = (s: Date) => ({ start: s, end: new Date(s.getTime() + durationMs) });

  if (repeat === 'none') return [withDuration(start)];

  const rangeEnd = recurrenceEndDate(start, endsOption);
  const results: { start: Date; end: Date }[] = [];

  const stepDays: Partial<Record<RepeatOption, number>> = {
    daily: 1,
    weekly: 7,
    biweekly: 14,
  };

  if (repeat === 'monthly') {
    for (let i = 0; results.length < MAX_OCCURRENCES; i++) {
      const candidate = addMonths(start, i);
      if (candidate > rangeEnd) break;
      results.push(withDuration(candidate));
    }
  } else if (repeat === 'weekdays' || repeat === 'weekends') {
    const wantWeekend = repeat === 'weekends';
    for (let i = 0; results.length < MAX_OCCURRENCES; i++) {
      const candidate = addDays(start, i);
      if (candidate > rangeEnd) break;
      const day = candidate.getDay();
      const isWeekend = day === 0 || day === 6;
      if (isWeekend === wantWeekend) results.push(withDuration(candidate));
    }
  } else {
    const step = stepDays[repeat] ?? 1;
    for (let i = 0; results.length < MAX_OCCURRENCES; i++) {
      const candidate = addDays(start, i * step);
      if (candidate > rangeEnd) break;
      results.push(withDuration(candidate));
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  label: { fontSize: 14, marginTop: 18, marginBottom: 8, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15 },
  pickerButton: { borderWidth: 1, borderRadius: 12, padding: 14 },
  pickerButtonText: { fontSize: 15 },
  row: { flexDirection: 'row' },
  sourceRow: { flexDirection: 'row', flexWrap: 'wrap' },
  sourcePill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, marginRight: 8, marginBottom: 8 },
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
  recurrenceRange: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  repeatNote: { fontSize: 12.5, marginTop: 10, lineHeight: 17 },
});

const switchStyles = StyleSheet.create({
  track: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
});
