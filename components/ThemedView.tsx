import { View, ViewProps } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

export function ThemedView(props: ViewProps) {
  const { currentTheme } = useTheme();
  const backgroundColor = currentTheme === 'dark' ? '#000000' : '#FFFFFF';
  
  return (
    <View 
      {...props} 
      style={[
        { backgroundColor },
        props.style,
      ]} 
    />
  );
}
