import { useState, useRef, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Dimensions, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { 
  useAnimatedStyle, 
  withSpring,
  withSequence,
  withDelay,
  useSharedValue,
  withTiming 
} from 'react-native-reanimated';
import { ThemedButton } from '@/components/ui/ThemedButton';

const { width } = Dimensions.get('window');

function NotificationCard({ children, style, colors }: { 
  children: React.ReactNode; 
  style?: any;
  colors: any;
}) {
  return (
    <View style={[{
      flexDirection: 'row',
      padding: 20,
      borderRadius: 20,
      alignItems: 'center',
      gap: 16,
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 5,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.1)',
    }, style]}>
      {children}
    </View>
  );
}

function EntryListCard({ children, style, colors }: { 
  children: React.ReactNode; 
  style?: any;
  colors: any;
}) {
  return (
    <View style={[{
      borderRadius: 20,
      overflow: 'hidden',
      backgroundColor: colors.card,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 5,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.1)',
    }, style]}>
      {children}
    </View>
  );
}

const ONBOARDING_SCREENS = [
  {
    title: 'Welcome to MeetCal',
    description: 'Track your weightlifting competitions with ease',
    mainContent: ({ colors }: { colors: any }) => (
      <Animated.View style={styles.demoContainer}>
        <View style={styles.calendarDemo}>
          <DemoCard style={{ width: '100%' }}>
            <View style={styles.iconCircle}>
              <IconSymbol name="calendar" size={32} color="#007AFF" />
            </View>
            <ThemedText style={[styles.demoText, { color: '#007AFF' }]}>
              Today's Sessions
            </ThemedText>
            <View style={[styles.previewCard, { backgroundColor: colors.card }]}>
              <ThemedText style={styles.previewText}>Session 1</ThemedText>
              <ThemedText style={[styles.previewTime, { color: colors.secondaryText }]}>9:00 AM</ThemedText>
            </View>
          </DemoCard>
        </View>
      </Animated.View>
    ),
  },
  {
    title: 'Find Your Sessions',
    description: 'Filter and search sessions by platform, weight class, or club',
    mainContent: ({ colors }: { colors: any }) => (
      <Animated.View style={styles.demoContainer}>
        <View style={styles.filterDemo}>
          <View style={[styles.platformBadge, { backgroundColor: '#007AFF' }]}>
            <ThemedText style={styles.platformText}>A</ThemedText>
          </View>
          <View style={[styles.platformBadge, { backgroundColor: '#34C759' }]}>
            <ThemedText style={styles.platformText}>B</ThemedText>
          </View>
          <View style={[styles.platformBadge, { backgroundColor: '#FF9500' }]}>
            <ThemedText style={styles.platformText}>C</ThemedText>
          </View>
        </View>
      </Animated.View>
    ),
  },
  {
    title: 'Never Miss a Lift',
    description: 'Save sessions and add to your calendar to get notified when they start',
    mainContent: ({ colors }: { colors: any }) => (
      <Animated.View style={styles.demoContainer}>
        <View style={styles.notificationDemo}>
          <NotificationCard colors={colors}>
            <IconSymbol 
              name={Platform.select({ 
                ios: "bell.fill",
                android: "notifications"
              })} 
              size={24} 
              color="#FF9500" 
            />
            <View style={styles.notificationContent}>
              <ThemedText style={styles.notificationTitle}>Session Starting Soon</ThemedText>
              <ThemedText style={[styles.notificationBody, { color: colors.secondaryText }]}>
                Session 1 - 81kg A - Red
              </ThemedText>
            </View>
          </NotificationCard>
        </View>
      </Animated.View>
    ),
  },
  {
    title: 'View All Entries',
    description: 'See all athletes, their entry totals, and 2024 competitions PRs in one place',
    mainContent: ({ colors }: { colors: any }) => (
      <Animated.View style={styles.demoContainer}>
        <View style={styles.entryListDemo}>
          <View style={styles.entryListHeader}>
            <ThemedText style={[styles.entryListHeaderText, { color: colors.secondaryText }]}>
              81kg A Session
            </ThemedText>
          </View>
          
          <EntryListCard colors={colors}>
            <View style={[styles.entryItem, { borderBottomColor: colors.border }]}>
              <View style={styles.entryInfo}>
                <ThemedText style={styles.entryName}>Sarah Johnson</ThemedText>
                <ThemedText style={[styles.entryClub, { color: colors.secondaryText }]}>
                  Garage Strength
                </ThemedText>
              </View>
              <ThemedText style={[styles.entryTotal, { color: colors.text }]}>
                205kg
              </ThemedText>
            </View>
            
            <View style={[styles.entryItem, { borderBottomColor: colors.border }]}>
              <View style={styles.entryInfo}>
                <ThemedText style={styles.entryName}>Emily Chen</ThemedText>
                <ThemedText style={[styles.entryClub, { color: colors.secondaryText }]}>
                  Cal Strength
                </ThemedText>
              </View>
              <ThemedText style={[styles.entryTotal, { color: colors.text }]}>
                198kg
              </ThemedText>
            </View>
            
            <View style={styles.entryItem}>
              <View style={styles.entryInfo}>
                <ThemedText style={styles.entryName}>Maria Garcia</ThemedText>
                <ThemedText style={[styles.entryClub, { color: colors.secondaryText }]}>
                  Power & Grace
                </ThemedText>
              </View>
              <ThemedText style={[styles.entryTotal, { color: colors.text }]}>
                201kg
              </ThemedText>
            </View>
          </EntryListCard>
        </View>
      </Animated.View>
    ),
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
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    screenBackground: currentTheme === 'dark' ? '#0A1A2F' : '#F0F7FF',
  };

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const value = await AsyncStorage.getItem('@hasSeenOnboarding');
      setHasSeenOnboarding(value === 'true');
    } catch (error) {
      console.error('Error checking onboarding status:', error);
    }
  };

  const handleComplete = async () => {
    try {
      await AsyncStorage.setItem('@hasSeenOnboarding', 'true');
      setHasSeenOnboarding(true);
      router.push('/user-profile');
    } catch (error) {
      console.error('Error saving onboarding status:', error);
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

  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1);
    opacity.value = withDelay(150, withSpring(1));
  }, [currentPage]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  // Only show the last page "Get Started" button on the final screen
  const isLastPage = currentPage === ONBOARDING_SCREENS.length - 1;

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.screenBackground }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {ONBOARDING_SCREENS.map((screen, index) => (
          <View key={index} style={styles.page}>
            <View style={[styles.pageContent, { paddingTop: insets.top + 40 }]}>
              <Animated.View style={[styles.contentContainer, animatedStyle]}>
                {screen.mainContent({ colors })}
                <View style={styles.textContainer}>
                  <ThemedText style={[styles.title, { color: colors.text }]}>
                    {screen.title}
                  </ThemedText>
                  <ThemedText style={[styles.description, { color: colors.secondaryText }]}>
                    {screen.description}
                  </ThemedText>
                </View>
              </Animated.View>
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
                {
                  backgroundColor: index === currentPage ? colors.text : colors.secondaryText + '40',
                },
              ]}
            />
          ))}
        </View>

        <ThemedButton
          onPress={isLastPage ? handleComplete : () => {
            scrollRef.current?.scrollTo({
              x: (currentPage + 1) * width,
              animated: true,
            });
          }}
          style={styles.button}
        >
          {isLastPage ? 'Get Started' : 'Continue'}
        </ThemedButton>
      </View>
    </ThemedView>
  );
}

function DemoCard({ children, style }: { children: React.ReactNode; style?: any }) {
  const { currentTheme } = useTheme();
  const colors = {
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
  };

  return (
    <View style={[{
      padding: 24,
      borderRadius: 22,
      backgroundColor: colors.card,
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 5,
    }, style]}>
      {children}
    </View>
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
    marginHorizontal: 4,
  },
  button: {
    marginTop: 20,
    width: '100%',
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
  demoContainer: {
    width: width - 80,
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  contentContainer: {
    alignItems: 'center',
    width: '100%',
  },
  calendarDemo: {
    width: '100%',
    padding: 24,
    borderRadius: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  demoText: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  filterDemo: {
    flexDirection: 'row',
    gap: 20,
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  platformText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: 40,
  },
  notificationDemo: {
    width: '100%',
    padding: 24,
    borderRadius: 24,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  notificationBody: {
    fontSize: 15,
    lineHeight: 20,
  },
  entryListDemo: {
    width: '100%',
    padding: 24,
    borderRadius: 24,
  },
  entryListHeader: {
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  entryListHeaderText: {
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryInfo: {
    flex: 1,
  },
  entryName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  entryClub: {
    fontSize: 15,
  },
  entryTotal: {
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 16,
  },
  previewCard: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewText: {
    fontSize: 17,
    fontWeight: '600',
  },
  previewTime: {
    fontSize: 15,
  },
}); 