import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, addMinutes, addDays, setHours, setMinutes } from 'date-fns';
import { upsertMeeting, deleteMeeting, deleteRecurrenceSeries } from '../db/database';
import { scheduleMeeting, cancelForEdit } from '../services/reminderEngine';
import { Meeting, ReminderOffsetMinutes, RepeatOption } from '../types';
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
  { label: 'Weekly', value: 'weekly' },
];

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
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [error, setError] = useState('');

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
      navigation.goBack();
      return;
    }

    const occurrences = buildOccurrences(start, end, repeat);
    const recurrenceId = occurrences.length > 1 ? `rec-${Date.now()}` : null;

    for (const occ of occurrences) {
      const meeting: Meeting = {
        id: `manual-${occ.start.getTime()}`,
        title: title.trim(),
        startTime: occ.start.toISOString(),
        endTime: occ.end.toISOString(),
        source: 'manual',
        meetingLink: link.trim() || null,
        notes: null,
        recurrenceId,
      };
      upsertMeeting(meeting);
      await scheduleMeeting(meeting);
    }

    navigation.goBack();
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

      <Text style={[styles.label, { color: colors.textSecondary }]}>Date</Text>
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
            <Text style={[styles.repeatNote, { color: colors.textMuted }]}>
              This will create several meetings ahead of time (each with its own reminders) — you can delete the
              whole series later from any one of them.
            </Text>
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

      <GradientButton label={isEditing ? 'Save changes' : 'Save meeting'} onPress={onSave} style={{ marginTop: 24 }} />

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

/** Expands a single start/end + Repeat choice into the list of occurrence
 * date pairs to create. Capped so a "Daily" or "Weekly" choice can't
 * silently schedule an unbounded number of alarms. */
function buildOccurrences(start: Date, end: Date, repeat: RepeatOption): { start: Date; end: Date }[] {
  const durationMs = end.getTime() - start.getTime();
  const withDuration = (s: Date) => ({ start: s, end: new Date(s.getTime() + durationMs) });

  if (repeat === 'none') return [withDuration(start)];

  if (repeat === 'daily') {
    return Array.from({ length: 60 }, (_, i) => withDuration(addDays(start, i)));
  }

  if (repeat === 'weekly') {
    return Array.from({ length: 26 }, (_, i) => withDuration(addDays(start, i * 7)));
  }

  // weekdays
  const results: { start: Date; end: Date }[] = [];
  for (let i = 0; results.length < 40 && i < 80; i++) {
    const candidate = addDays(start, i);
    const day = candidate.getDay();
    if (day !== 0 && day !== 6) results.push(withDuration(candidate));
  }
  return results;
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
  label: { fontSize: 13, marginTop: 18, marginBottom: 8, fontWeight: '600' },
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
  error: { marginTop: 16, fontSize: 13 },
  deleteLink: { textAlign: 'center', fontSize: 13, fontWeight: '600' },
  repeatNote: { fontSize: 11, marginTop: 8, lineHeight: 15 },
});

const switchStyles = StyleSheet.create({
  track: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
});
