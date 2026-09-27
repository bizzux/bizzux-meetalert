import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
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
import { showAlert } from '../services/appAlert';
import { Meeting, ReminderOffsetMinutes, RepeatOption, RecurrenceEndOption } from '../types';
import { useThemeColors } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import PillGroup from '../components/Pill';
import GradientButton from '../components/GradientButton';

// Weekdays / Weekends / Recurring are the priority choices — Bi-weekly and
// Monthly cover the remaining interval-based patterns that aren't a fixed
// set of weekdays.
const REPEAT_OPTIONS: { label: string; value: RepeatOption }[] = [
  { label: 'Does not repeat', value: 'none' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekends', value: 'weekends' },
  { label: 'Recurring', value: 'recurring' },
  { label: 'Bi-weekly', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
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

type CardKey = 'when' | 'repeat' | 'remind' | 'details';

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
  const [organizer, setOrganizer] = useState(editingMeeting?.organizer ?? '');
  const [notes, setNotes] = useState(editingMeeting?.notes ?? '');
  const [repeat, setRepeat] = useState<RepeatOption>('none');
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

  // Which of the four cards below are open — everything but "What & when"
  // starts collapsed so the common case (a quick, undecorated meeting) is a
  // short screen instead of one long scroll of every field at once. Each
  // collapsed card still shows a live summary of what's set inside it (see
  // the *Summary() helpers below), so nothing is hidden, just tucked away.
  const [expanded, setExpanded] = useState<Record<CardKey, boolean>>({
    when: true,
    repeat: false,
    remind: false,
    details: false,
  });
  const toggleCard = (key: CardKey) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // The free-text box on What & when — "Standup tomorrow 9am for 30 min" —
  // a typed sibling to Take Snapshot's photo-based fill. Same idea (fills
  // Title/Date/Start/End so there's less to type by hand), different input.
  const [quickText, setQuickText] = useState('');

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
        setDate(parsed.startTime);
        setStartTime(parsed.startTime);
        setEndTime(parsed.endTime ?? addMinutes(parsed.startTime, 30));
      }
      if (parsed.link && !link.trim()) setLink(parsed.link);

      showAlert('Filled from photo', 'Double-check the details below, then save.');
    } finally {
      setCapturing(false);
    }
  };

  // "Fill in" — parses the quick-add line and applies it to the same
  // Title/Date/Start/End fields below. Unlike Take Snapshot's passive scan,
  // this is an explicit one-tap action, so it's fine to overwrite whatever
  // was there before (that's the point of using it).
  const onQuickFill = () => {
    const parsed = parseQuickAdd(quickText, date);
    if (!parsed) {
      showAlert(
        "Couldn't quite parse that",
        'Try including a day (like "tomorrow" or "Friday") and a time (like "9am" or "2pm to 3pm").'
      );
      return;
    }
    setTitle(parsed.title);
    if (parsed.date) setDate(parsed.date);
    if (parsed.startTime) {
      setStartTime(parsed.startTime);
      setEndTime(parsed.endTime ?? addMinutes(parsed.startTime, 45));
    }
    setQuickText('');
    setExpanded((prev) => ({ ...prev, when: true }));
    showAlert('Filled in from your note', 'Double-check the details below, then save.');
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

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
    >
      {!isEditing && (
        <View style={[styles.quickFillBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <Text style={[styles.quickFillLabel, { color: colors.secondary }]}>
            NEW — DESCRIBE IT, WE'LL FILL IT IN
          </Text>
          <View style={styles.quickFillRow}>
            <TextInput
              style={[styles.quickFillInput, { color: colors.textPrimary }]}
              value={quickText}
              onChangeText={setQuickText}
              placeholder="Try: Standup tomorrow 9am for 30 min"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={onQuickFill}
              returnKeyType="done"
            />
            <TouchableOpacity
              onPress={onQuickFill}
              style={[styles.quickFillButton, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.quickFillButtonText}>Fill in</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.quickFillHint, { color: colors.textMuted }]}>
            Fills Title, Date and Start time below — same idea as Take Snapshot, just typed instead of photographed.
          </Text>
        </View>
      )}

      <SectionCard title="What & when" expanded={expanded.when} onToggle={() => toggleCard('when')} colors={colors}>
        <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>Meeting title</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Weekly sync"
          placeholderTextColor={colors.textMuted}
        />

        {!isEditing && (
          <GradientButton
            label={capturing ? 'Reading photo…' : 'Take Snapshot to auto-fill'}
            iconImage={require('../../assets/camera-icon.png')}
            iconTint={colors.textOnPrimary}
            onPress={onCaptureSnapshot}
            loading={capturing}
            style={{ marginTop: 14 }}
          />
        )}

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

        <Text style={[styles.label, { color: colors.textSecondary }]}>Duration — sets End time for you</Text>
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
          End time still opens its own picker too — this is just a faster way to set it.
        </Text>
      </SectionCard>

      {!isEditing && (
        <SectionCard
          title="Repeat"
          summary={repeatSummary(repeat, daysOfWeek, endsOption, date, customEndDate)}
          expanded={expanded.repeat}
          onToggle={() => toggleCard('repeat')}
          colors={colors}
        >
          <PillGroup options={REPEAT_OPTIONS} selected={[repeat]} onToggle={(v) => setRepeat(v)} />

          {repeat === 'recurring' && (
            <>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Repeats on</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dayScrollContent}
              >
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
                      <Text style={{ color: isSelected ? colors.textOnPrimary : colors.textSecondary, fontWeight: '700', fontSize: 13 }}>
                        {d.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}

          {repeat !== 'none' && (
            <View style={[styles.recurrenceRange, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.textSecondary, marginTop: 0 }]}>Ends</Text>
              <PillGroup
                options={RECURRENCE_END_OPTIONS}
                selected={[endsOption]}
                onToggle={(v) => setEndsOption(v)}
                tone="secondary"
              />
              {endsOption === 'custom' && (
                <TouchableOpacity
                  style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10 }]}
                  onPress={() => setShowCustomEndPicker(true)}
                >
                  <Text style={[styles.pickerButtonText, { color: colors.textPrimary }]}>
                    Ends on {format(customEndDate, 'EEE, d MMM yyyy')}
                  </Text>
                </TouchableOpacity>
              )}
              {showCustomEndPicker && (
                <DateTimePicker
                  value={customEndDate}
                  mode="date"
                  minimumDate={date}
                  display="default"
                  onChange={onChangeCustomEnd}
                />
              )}
              <Text style={[styles.repeatNote, { color: colors.textMuted }]}>
                Creates up to {MAX_OCCURRENCES} meetings between {format(date, 'd MMM')} and{' '}
                {format(recurrenceEndDate(date, endsOption, customEndDate), 'd MMM yyyy')}, each with its own
                reminders. You can delete just one occurrence or the whole series later from any of them.
              </Text>
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
  date: Date,
  customEndDate: Date
): string {
  if (repeat === 'none') return 'Does not repeat';
  const endsLabel = format(recurrenceEndDate(date, endsOption, customEndDate), 'd MMM');
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
  row: { flexDirection: 'row' },
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
  dayScrollContent: { gap: 8, paddingRight: 8 },
  dayChip: {
    width: 48,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Quick-fill box
  quickFillBox: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 14, marginBottom: 14 },
  quickFillLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  quickFillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  quickFillInput: { flex: 1, fontSize: 14.5, paddingVertical: 4 },
  quickFillButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  quickFillButtonText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  quickFillHint: { fontSize: 11, marginTop: 8, lineHeight: 15 },

  // Duration chips
  durationRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  durationChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  durationHint: { fontSize: 11.5, marginTop: 8, lineHeight: 15 },

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
