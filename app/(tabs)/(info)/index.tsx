import { StyleSheet, View, Pressable, Platform, ScrollView } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import EventInfoScreen from '@/app/(screens)/event-info';
import { Colors } from '@/constants/Colors';

export default function InfoScreen() {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();


  // Define theme colors
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF', // iOS blue stays the same in both modes
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{
          headerTitle: 'Info',
          headerTitleStyle: {
            color: colors.text,
          },
          headerStyle: {
            backgroundColor: currentTheme === 'dark' ? Colors.dark.background : Colors.light.background
          },
          headerShadowVisible: false,
        }}
      />

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { 
            paddingHorizontal: 20, 
            paddingTop: 20,
            paddingBottom: Math.max(80, insets.bottom + 60)
          }
        ]}
        showsVerticalScrollIndicator={false}
      >

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          {/* <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/event-info')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Event Info
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable> */}

          <EventInfoScreen />

          {/* <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/weightlifting-wrapped')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Weightlifting Wrapped
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable> */}

          {/* <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/offline-data')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Offline Data
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable> */}
        </View>

        <ThemedText style={[styles.sectionHeader, { color: colors.secondaryText }]}>
          National
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/adap-records')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Adaptive American Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/all-meet-results')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                All Meet Results
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/share-results-by-club')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Club Meet Results
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/national-rankings')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                National Rankings
              </ThemedText>
              <IconSymbol
                name={Platform.OS === 'ios' ? 'chevron.right' : 'chevron-forward'}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/records')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                National & World Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/wso-records')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                WSO Records
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/new-qualifying-totals')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Qualifying Totals
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        <ThemedText style={[styles.sectionHeader, { color: colors.secondaryText }]}>
          International
        </ThemedText>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/new-standards')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                A/B Standards
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => router.push('/(screens)/rankings')}
          >
            <View style={styles.linkRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                International Rankings
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionHeader: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 8,
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  sectionPressed: {
    backgroundColor: '#F5F5F5',
  },
  label: {
    fontSize: 16,
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: {
    fontSize: 17,
    lineHeight: 22,
  },
  addressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionText: {
    fontSize: 16,
  },
  subscriptionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subscriptionInfo: {
    flex: 1,
    marginRight: 16,
  },
  subscriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  subscriptionPreview: {
    fontSize: 16,
    lineHeight: 21,
  },
  dangerZone: {
    marginTop: 8,
    alignItems: 'center',
  },
  resetButton: {
    backgroundColor: '#FF3B30', // iOS red
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
  },
  profileContent: {
    paddingVertical: 4,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  profileValue: {
    fontSize: 16,
  },
  copyright: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  meetValue: {
    fontSize: 15,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    marginHorizontal: 16,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    padding: 4,
    zIndex: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: {
    fontSize: 17,
  },
}); 
