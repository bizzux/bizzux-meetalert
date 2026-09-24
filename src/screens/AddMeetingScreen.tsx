import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format, addMinutes } from 'date-fns';
import { upsertMeeting } from '../db/database';
import { scheduleMeeting } from '../services/reminderEngine';
import { Meeting } from '../types';

export default function AddMeetingScreen() {
  const navigation = useNavigation<any>();
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState<Date>(roundToNext5Minutes(new Date()));
  const [endTime, setEndTime] = useState<Date>(addMinutes(roundToNext5Minutes(new Date()), 30));
  const [link, setLink] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [error, setError] = useState('');

  const onChangeStart = (_event: DateTimePickerEvent, selected?: Date) => {
    setShowStartPicker(Platform.OS === 'ios');
    if (selected) {
      setStartTime(selected);
      // Keep end time at least 15 minutes after start.
      if (selected >= endTime) {
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
    if (endTime <= startTime) {
      setError('End time must be after start time.');
      return;
    }

    const meeting: Meeting = {
      id: `manual-${Date.now()}`,
      title: title.trim(),
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      source: 'manual',
      meetingLink: link.trim() || null,
      notes: null,
    };

    upsertMeeting(meeting);
    await scheduleMeeting(meeting);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Weekly sync"
        autoFocus
      />

      <Text style={styles.label}>Start time</Text>
      <TouchableOpacity style={styles.pickerButton} onPress={() => setShowStartPicker(true)}>
        <Text style={styles.pickerButtonText}>{format(startTime, 'EEE, MMM d · h:mm a')}</Text>
      </TouchableOpacity>
      {showStartPicker && (
        <DateTimePicker value={startTime} mode="datetime" display="default" onChange={onChangeStart} />
      )}

      <Text style={styles.label}>End time</Text>
      <TouchableOpacity style={styles.pickerButton} onPress={() => setShowEndPicker(true)}>
        <Text style={styles.pickerButtonText}>{format(endTime, 'EEE, MMM d · h:mm a')}</Text>
      </TouchableOpacity>
      {showEndPicker && (
        <DateTimePicker value={endTime} mode="datetime" display="default" onChange={onChangeEnd} />
      )}

      <Text style={styles.label}>Meeting link (optional)</Text>
      <TextInput
        style={styles.input}
        value={link}
        onChangeText={setLink}
        placeholder="https://teams.microsoft.com/..."
        autoCapitalize="none"
        keyboardType="url"
      />

      {!!error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.saveButton} onPress={onSave}>
        <Text style={styles.saveButtonText}>Save meeting</Text>
      </TouchableOpacity>
    </View>
  );
}

function roundToNext5Minutes(date: Date): Date {
  const rounded = new Date(date);
  const remainder = 5 - (rounded.getMinutes() % 5);
  rounded.setMinutes(rounded.getMinutes() + (remainder === 5 ? 0 : remainder), 0, 0);
  return rounded;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  label: { fontSize: 13, color: '#555', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 15 },
  pickerButton: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  pickerButtonText: { fontSize: 15, color: '#111' },
  error: { color: '#dc2626', marginTop: 16, fontSize: 13 },
  saveButton: { backgroundColor: '#2563eb', padding: 14, borderRadius: 8, marginTop: 28, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
