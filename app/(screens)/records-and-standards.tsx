import { StyleSheet, View, Pressable } from 'react-native'
import { ThemedText } from '@/components/ThemedText'
import { ThemedView } from '@/components/ThemedView'
import { IconSymbol } from '@/components/ui/IconSymbol'
import { useTheme } from '@/contexts/ThemeContext'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function RecordsAndStandardsScreen() {
  const { currentTheme } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F5F5F5',
    link: '#007AFF',
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Totals, Standards, & Records',
          headerBackTitle: 'Back',
          headerTitleStyle: {
            color: colors.text,
          },
          headerTintColor: '#007AFF',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
        }}
      />

      <View style={[
        styles.card, 
        { 
          backgroundColor: colors.card,
          marginTop: 16,
        }
      ]}>
        <Pressable
          style={({ pressed }) => [
            styles.section,
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            pressed && { backgroundColor: colors.pressed }
          ]}
          onPress={() => router.push('/(screens)/qualifying-totals')}
        >
          <View style={styles.linkRow}>
            <ThemedText style={[styles.label, { color: colors.text }]}>
              Current Bodyweight Qualifying Totals
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
          onPress={() => router.push('/(screens)/new-qualifying-totals')}
        >
          <View style={styles.linkRow}>
            <ThemedText style={[styles.label, { color: colors.text }]}>
              New Bodyweight Qualifying Totals
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
          onPress={() => router.push('/(screens)/current-standards')}
        >
          <View style={styles.linkRow}>
            <ThemedText style={[styles.label, { color: colors.text }]}>
              Current Bodyweight Standards
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
          onPress={() => router.push('/(screens)/new-standards')}
        >
          <View style={styles.linkRow}>
            <ThemedText style={[styles.label, { color: colors.text }]}>
              New Bodyweight Standards
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
          onPress={() => router.push('/(screens)/records')}
        >
          <View style={styles.linkRow}>
            <ThemedText style={[styles.label, { color: colors.text }]}>
              USAW American Records
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
          onPress={() => router.push('/(screens)/usamw_records')}
        >
          <View style={styles.linkRow}>
            <ThemedText style={[styles.label, { color: colors.text }]}>
              USAMW American Records
            </ThemedText>
            <IconSymbol name="chevron.right" size={20} color={colors.link} />
          </View>
        </Pressable>

      </View>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    borderRadius: 12,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  label: {
    fontSize: 16,
    marginBottom: 4,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
}) 