import { View, Pressable, StyleSheet } from 'react-native';
import { useThemeColor } from '../hooks/useThemeColor';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';

interface PageIndicatorProps {
  count: number;
  currentPage: number;
  onPageChange?: (page: number) => void;
}

export function PageIndicator({ count, currentPage, onPageChange }: PageIndicatorProps) {
  const tintColor = useThemeColor({}, 'tint');
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();

  const containerBackground = currentTheme === 'dark' ? '#3A3A3C' : 'rgba(0,0,0,0.05)';
  const inactiveDotColor = currentTheme === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)';

  return (
    <View style={[
      styles.container, 
      { 
        paddingBottom: insets.bottom + 80, // Account for tab bar height
      }
    ]}>
      <View style={[
        styles.dotsContainer,
        {
          backgroundColor: containerBackground,
        }
      ]}>
        {Array.from({ length: count }).map((_, index) => (
          <Pressable
            key={index}
            onPress={() => onPageChange?.(index)}
            style={[
              styles.dot,
              {
                backgroundColor: index === currentPage 
                  ? tintColor 
                  : inactiveDotColor,
                borderColor: index === currentPage ? tintColor : 'transparent',
              },
            ]}
            hitSlop={8}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    zIndex: 2,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    borderRadius: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
}); 