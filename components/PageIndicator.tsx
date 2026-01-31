import { View, Pressable, StyleSheet, Platform } from 'react-native';
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

  const containerBackground = currentTheme === 'dark' ? 'rgba(58,58,60,0.65)' : 'rgba(0,0,0,0.08)';
  const containerBorder = currentTheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const inactiveDotColor = currentTheme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
  const activeDotShadow = currentTheme === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.2)';

  return (
    <View style={[
      styles.container,
      { 
        bottom: Platform.OS === 'ios' ? insets.bottom + 50 : insets.bottom + 70,
      }
    ]}>
      <View style={[
        styles.dotsContainer,
        {
          backgroundColor: containerBackground,
          borderColor: containerBorder,
        }
      ]}>
        {Array.from({ length: count }).map((_, index) => (
          <Pressable
            key={index}
            onPress={() => onPageChange?.(index)}
            style={[
              styles.dot,
              index === currentPage ? styles.activeDot : styles.inactiveDot,
              {
                backgroundColor: index === currentPage ? '#007AFF' : '#5A9AD4',
                shadowColor: index === currentPage ? activeDotShadow : 'transparent',
                borderColor: index === currentPage ? 'transparent' : 'transparent',
              }
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
    paddingVertical: 12,
    zIndex: 2,
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  dot: {
    borderRadius: 999,
  },
  inactiveDot: {
    width: 6,
    height: 6,
  },
  activeDot: {
    width: 18,
    height: 6,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 3,
  },
}); 
