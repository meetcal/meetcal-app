import { useState, useRef, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Dimensions, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const ONBOARDING_SCREENS = [
  {
    title: 'Welcome to MeetCal',
    description: 'Your ultimate competition companion for tracking weightlifting events',
    icon: 'calendar',
  },
  {
    title: 'Stay Organized',
    description: 'Track sessions, save athletes, and never miss a lift with our powerful features',
    icon: 'bookmark.fill',
  },
  {
    title: 'Unlock Premium Features',
    description: 'Get access to athlete tracking, custom alerts, and more with a subscription',
    icon: 'star.fill',
  },
];

export default function Onboarding() {
  const [currentPage, setCurrentPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  const handleComplete = async () => {
    if (currentPage === ONBOARDING_SCREENS.length - 1) {
      // Don't set hasSeenOnboarding when viewing from info screen
      if (!hasSeenOnboarding) {
        await AsyncStorage.setItem('hasSeenOnboarding', 'true');
      }
      router.replace('/(screens)/subscription');
    } else {
      // Scroll to next page
      scrollRef.current?.scrollTo({
        x: width * (currentPage + 1),
        animated: true,
      });
    }
  };

  const handleScroll = (event: any) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentPage(page);
  };

  // Add a back button when viewing from info screen
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      const seen = await AsyncStorage.getItem('hasSeenOnboarding');
      if (seen) {
        // Add a back button to the status bar area
        return (
          <Pressable 
            style={[
              styles.backButton,
              { top: insets.top + 10 }
            ]}
            onPress={() => router.back()}
          >
            <IconSymbol name="chevron.left" size={28} color={colors.text} />
          </Pressable>
        );
      }
      return null;
    };
    
    checkOnboardingStatus();
  }, []);

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {ONBOARDING_SCREENS.map((screen, index) => (
          <View 
            key={index} 
            style={styles.page}
          >
            <View style={[
              styles.pageContent,
              { paddingTop: insets.top + 40 }
            ]}>
              <View style={styles.iconContainer}>
                <IconSymbol name={screen.icon} size={64} color="#007AFF" />
              </View>
              <View style={styles.textContainer}>
                <ThemedText 
                  style={[
                    styles.title, 
                    { color: colors.text }
                  ]}
                  adjustsFontSizeToFit
                >
                  {screen.title}
                </ThemedText>
                <ThemedText 
                  style={[
                    styles.description, 
                    { color: colors.secondaryText }
                  ]}
                >
                  {screen.description}
                </ThemedText>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.pagination}>
          {ONBOARDING_SCREENS.map((_, index) => (
            <View
              key={index}
              style={[
                styles.paginationDot,
                index === currentPage && styles.paginationDotActive,
              ]}
            />
          ))}
        </View>

        <Pressable
          style={styles.button}
          onPress={handleComplete}
        >
          <ThemedText style={styles.buttonText}>
            {currentPage === ONBOARDING_SCREENS.length - 1 ? 'Get Started' : 'Continue'}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    width,
  },
  pageContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#007AFF15',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  textContainer: {
    alignItems: 'center',
    maxWidth: 500,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 38,
  },
  description: {
    fontSize: 17,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 24,
  },
  footer: {
    padding: 20,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF40',
    marginHorizontal: 4,
  },
  paginationDotActive: {
    backgroundColor: '#007AFF',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
}); 