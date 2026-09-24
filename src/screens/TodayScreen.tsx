import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import { Meeting } from '../types';
import { getMeetingsForDay, upsertMeeting } from '../db/database';
import { fetchTodaysGraphMeetings } from '../services/graphCalendar';
import { fetchTodaysLocalMeetings, dedupeAgainstGraph } from '../services/localCalendar';
import { scheduleMeeting, confirmJoined } from '../services/reminderEngine';

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadMeetings = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const rows = getMeetingsForDay(start.toISOString(), end.toISOString());
    setMeetings(rows);
  }, []);

  const syncCalendars = useCallback(async () => {
    setRefreshing(true);
    try {
      const graphMeetings = await fetchTodaysGraphMeetings();
      const localMeetingsRaw = await fetchTodaysLocalMeetings();
      const localMeetings = dedupeAgainstGraph(localMeetingsRaw, graphMeetings);

      for (const meeting of [...graphMeetings, ...localMeetings]) {
        upsertMeeting(meeting);
        await scheduleMeeting(meeting);
      }
    } finally {
      await loadMeetings();
      setRefreshing(false);
    }
  }, [loadMeetings]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  return (
    <View style={styles.container}>
      <FlatList
        data={meetings}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={syncCalendars} />}
        ListEmptyComponent={
          <Text style={styles.empty}>No meetings today. Pull to sync, or add one manually.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.time}>
                {format(new Date(item.startTime), 'h:mm a')} – {format(new Date(item.endTime), 'h:mm a')}
              </Text>
              <Text style={styles.source}>{sourceLabel(item.source)}</Text>
            </View>
            <TouchableOpacity style={styles.confirmButton} onPress={() => confirmJoined(item.id)}>
              <Text style={styles.confirmButtonText}>I've joined</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddMeeting')}>
        <Text style={styles.addButtonText}>+ Add meeting</Text>
      </TouchableOpacity>
    </View>
  );
}

function sourceLabel(source: Meeting['source']): string {
  if (source === 'graph') return 'Teams / Outlook';
  if (source === 'local_calendar') return 'Device calendar';
  return 'Manual';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  empty: { textAlign: 'center', marginTop: 48, color: '#888' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 14, color: '#555', marginTop: 2 },
  source: { fontSize: 12, color: '#999', marginTop: 2 },
  confirmButton: { backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  confirmButtonText: { color: '#fff', fontWeight: '600' },
  addButton: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: '#111827',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
  },
  addButtonText: { color: '#fff', fontWeight: '600' },
});
