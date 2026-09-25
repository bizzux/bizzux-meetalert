import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../theme';

interface Option<T> {
  label: string;
  value: T;
}

interface Props<T> {
  options: Option<T>[];
  selected: T[];
  onToggle: (value: T) => void;
  tone?: 'primary' | 'secondary';
}

/** Row of rounded selectable pills — used for calendar-source pickers,
 * reminder-offset chips, and the History period switcher. */
export default function PillGroup<T extends string | number>({
  options,
  selected,
  onToggle,
  tone = 'primary',
}: Props<T>) {
  const colors = useThemeColors();
  const activeColor = tone === 'secondary' ? colors.secondary : colors.primary;

  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const isActive = selected.includes(opt.value);
        return (
          <TouchableOpacity
            key={String(opt.value)}
            onPress={() => onToggle(opt.value)}
            style={[
              styles.pill,
              {
                backgroundColor: isActive ? activeColor : colors.surfaceAlt,
                borderColor: isActive ? activeColor : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: isActive ? colors.textOnPrimary : colors.textSecondary },
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: { fontSize: 13, fontWeight: '600' },
});
