import { TextInput as RNTextInput, StyleSheet } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

interface TextInputProps extends React.ComponentProps<typeof RNTextInput> {
  style?: any;
}

export const TextInput = ({ style, ...props }: TextInputProps) => {
  const { currentTheme } = useTheme();
  
  return (
    <RNTextInput
      style={[
        styles.input,
        style,
        {
          backgroundColor: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
          color: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
        }
      ]}
      placeholderTextColor={currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B'}
      {...props}
    />
  );
};

const styles = StyleSheet.create({
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 15,
  },
}); 