import { View, ViewProps } from 'react-native';
import { useAppColors } from '@/hooks/useAppColors';

/**
 * A `View` on the screen background. It painted white in light mode while
 * the palette's background (and every header) is #F5F5F5.
 */
export function ThemedView(props: ViewProps) {
  const colors = useAppColors();

  return (
    <View
      {...props}
      style={[
        { backgroundColor: colors.background },
        props.style,
      ]}
    />
  );
}
