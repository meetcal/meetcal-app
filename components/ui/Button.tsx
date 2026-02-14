import { Pressable, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native'

interface ButtonProps {
  onPress: () => void
  children: string | number | (string | number)[]
  style?: ViewStyle
  textStyle?: TextStyle
  disabled?: boolean
}

export function Button({ onPress, children, style, textStyle, disabled }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        style,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      disabled={disabled}
    >
      <Text style={[styles.text, textStyle, disabled && styles.disabledText]}>
        {children}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    backgroundColor: '#A1A1A1',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledText: {
    color: '#FFFFFF',
  },
}) 