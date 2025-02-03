import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { IconSymbol } from './ui/IconSymbol';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useRouter } from 'expo-router';

interface GatedFilterButtonProps {
  onPress: () => void;
  label: string;
  colors: {
    card: string;
    border: string;
    secondaryText: string;
    pressed: string;
  };
}

export function GatedFilterButton({ onPress, label, colors }: GatedFilterButtonProps) {
  const { isSubscribed } = useSubscription();
  const router = useRouter();

  const handlePress = () => {
    if (isSubscribed) {
      onPress();
    } else {
      router.push('/(screens)/subscription');
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.filterButton,
        { 
          backgroundColor: colors.card,
          borderColor: colors.border 
        },
        pressed && { backgroundColor: colors.pressed }
      ]}
      onPress={handlePress}
    >
      <ThemedText style={[styles.filterButtonText, { color: colors.secondaryText }]}>
        {label}
      </ThemedText>
      <IconSymbol name="chevron.down" size={12} color={colors.secondaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
  },
  filterButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
}); 