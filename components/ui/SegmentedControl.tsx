import { StyleSheet, View, TouchableOpacity, Animated } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useEffect, useRef } from 'react';

type Option = {
  label: string;
  value: string;
};

type Props = {
  values: Option[];
  selectedValue: string;
  onChange: (value: string) => void;
};

export function SegmentedControl({ values, selectedValue, onChange }: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const segmentWidth = 100 / values.length;

  useEffect(() => {
    const selectedIndex = values.findIndex(v => v.value === selectedValue);
    Animated.spring(translateX, {
      toValue: selectedIndex * segmentWidth,
      useNativeDriver: true,
    }).start();
  }, [selectedValue, values, segmentWidth]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.selectedSegment,
          {
            width: `${segmentWidth}%`,
            transform: [{
              translateX: translateX.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            }],
          },
        ]}
      />
      {values.map((option) => (
        <TouchableOpacity
          key={option.value}
          style={[styles.segment, { width: `${segmentWidth}%` }]}
          onPress={() => onChange(option.value)}
        >
          <ThemedText
            style={[
              styles.segmentText,
              selectedValue === option.value && styles.selectedText,
            ]}
          >
            {option.label}
          </ThemedText>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    padding: 2,
    position: 'relative',
    height: 32,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  selectedSegment: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
  },
  selectedText: {
    color: '#000000',
  },
}); 