import { lightImpact } from '@/lib/haptics';
import { Pressable, type PressableProps } from 'react-native';

export function HapticTab(props: PressableProps) {
  return (
    <Pressable
      {...props}
      onPressIn={(ev) => {
        // Add a soft haptic feedback when pressing down on the tabs.
        lightImpact();
        props.onPressIn?.(ev);
      }}
    />
  );
}
