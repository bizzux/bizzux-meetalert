import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { format } from 'date-fns';
import { getHistory } from '../db/database';

export default function HistoryScreen() {
  const [items, setItems] = useState<ReturnType<typeof getHistory>>([]);

  useEffect(() => {
    setItems(getHistory());
  }, []);

  const attended = items.filter((i) => i.status === 'attended').length;
  const total = items.filter((i) => i.status).length;

  return (
    <View style={styles.container}>
      {total > 0 && (
        <Text style={styles.summary}>
          {attended} of {total} meetings attended
        </Text>
      )}
      <FlatList
        data={items}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.time}>{format(new Date(item.startTime), 'MMM d, h:mm a')}</Text>
            </View>
            <Text style={[styles.status, item.status === 'attended' ? styles.attended : styles.missed]}>
              {item.status === 'attended' ? 'Attended' : item.status === 'missed' ? 'Missed' : 'Pending'}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  summary: { padding: 16, fontSize: 14, color: '#444', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: { fontSize: 15, fontWeight: '600' },
  time: { fontSize: 13, color: '#777', marginTop: 2 },
  status: { fontSize: 13, fontWeight: '700', paddingHorizontal: 8 },
  attended: { color: '#16a34a' },
  missed: { color: '#dc2626' },
});
