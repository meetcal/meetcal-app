import { StyleSheet, View, Linking, Pressable, Platform, ScrollView, Switch } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { venueConfig, getFullAddress } from '@/config/venue';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function InfoScreen() {
  const { currentTheme, setTheme } = useTheme();
  const insets = useSafeAreaInsets();

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

  const handlePress = (url: string) => {
    Linking.openURL(url);
  };

  const handleAddressPress = () => {
    const address = "400 N High St, Columbus, OH 43215";
    const encodedAddress = encodeURIComponent(address);
    
    // Different URL schemes for iOS and Android
    const mapsUrl = Platform.select({
      ios: `maps://maps.apple.com/?address=${encodedAddress}`,
      android: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
      default: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
    });

    Linking.canOpenURL(mapsUrl).then((supported) => {
      if (supported) {
        Linking.openURL(mapsUrl);
      } else {
        // Fallback to browser if maps app cannot be opened
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`);
      }
    });
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Venue Info */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            Venue Information
          </ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={handleAddressPress}
          >
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Location
            </ThemedText>
            <View>
              <ThemedText style={[styles.value, { color: colors.text, marginBottom: 4 }]}>
                {venueConfig.name}
              </ThemedText>
              <View style={styles.addressContainer}>
                <View>
                  <ThemedText style={[styles.link, { color: colors.link }]}>
                    {venueConfig.address.street}
                  </ThemedText>
                  <ThemedText style={[styles.link, { color: colors.link }]}>
                    {venueConfig.address.city}, {venueConfig.address.state} {venueConfig.address.zip}
                  </ThemedText>
                </View>
                <IconSymbol name="chevron.right" size={20} color={colors.link} />
              </View>
            </View>
          </Pressable>
        </View>

        {/* USAW Contact */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            USAW Contact
          </ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && styles.sectionPressed
            ]}
            onPress={() => handlePress('mailto:events@usaweightlifting.org')}
          >
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Email
            </ThemedText>
            <View style={styles.linkRow}>
              <ThemedText style={[styles.link, { color: colors.link }]}>
                events@usaweightlifting
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        {/* App Info */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            App Information
          </ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              { borderBottomColor: colors.border },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => handlePress('mailto:memohnsen@gmail.com')}
          >
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Support
            </ThemedText>
            <View style={styles.linkRow}>
              <ThemedText style={[styles.link, { color: colors.link }]}>
                memohnsen@gmail.com
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
            onPress={() => handlePress('https://wl-wargames.com')}
          >
            <ThemedText style={[styles.label, { color: colors.secondaryText }]}>
              Other Projects
            </ThemedText>
            <View style={styles.linkRow}>
              <ThemedText style={[styles.link, { color: colors.link }]}>
                War Games
              </ThemedText>
              <IconSymbol name="chevron.right" size={20} color={colors.link} />
            </View>
          </Pressable>
        </View>

        {/* Theme Settings */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ThemedText style={[styles.cardTitle, { color: colors.text }]}>
            App Settings
          </ThemedText>
          
          <View style={[styles.section, styles.lastSection]}>
            <View style={styles.settingRow}>
              <ThemedText style={[styles.settingLabel, { color: colors.text }]}>
                Dark Mode
              </ThemedText>
              <Switch
                value={currentTheme === 'dark'}
                onValueChange={(value) => setTheme(value ? 'dark' : 'light')}
                trackColor={{ false: '#E1E1E1', true: '#34C759' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
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
  content: {
    padding: 16,
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
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    padding: 16,
    paddingBottom: 8,
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
    fontSize: 15,
    marginBottom: 4,
  },
  value: {
    fontSize: 17,
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
    alignItems: 'flex-start',
    marginTop: 2,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  settingLabel: {
    fontSize: 17,
  },
}); 