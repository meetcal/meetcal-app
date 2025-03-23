import { StyleSheet } from 'react-native'
import { ThemedView } from '@/components/ThemedView'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useTheme } from '@/contexts/ThemeContext'

export default function WarmupDetailsScreen() {
  const { currentTheme } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Warmup Details',
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
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
}) 