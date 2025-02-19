import { StyleSheet, View, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { venueConfig } from '@/config/venue';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Linking, Platform } from 'react-native';

export default function EventInfoScreen() {
  const { currentTheme } = useTheme();

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    link: '#007AFF',
    pressed: currentTheme === 'dark' ? '#2C2C2E' : '#F2F2F2',
    primary: currentTheme === 'dark' ? '#0A84FF' : '#007AFF',
  };

  const handleAddressPress = () => {
    const address = "400 N High St, Columbus, OH 43215";
    const encodedAddress = encodeURIComponent(address);
    
    const mapsUrl = Platform.select({
      ios: `maps://maps.apple.com/?address=${encodedAddress}`,
      android: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
      default: `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`,
    });

    Linking.canOpenURL(mapsUrl).then((supported) => {
      if (supported) {
        Linking.openURL(mapsUrl);
      } else {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`);
      }
    });
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ 
        title: "Event Info",
        headerBackTitle: "Back",
        headerShown: true,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        animation: 'slide_from_right',
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerShadowVisible: false,
      }} />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.section}>
          <ThemedText style={[styles.mainTitle, { color: colors.text }]}>
            Virus Weightlifting Series 1 & University Nationals
          </ThemedText>
        </View>
        
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Pressable
          style={({ pressed }) => [
            styles.section,
            styles.lastSection,
            pressed && { backgroundColor: colors.pressed }
          ]}
          onPress={handleAddressPress}
        >
          <ThemedText style={[styles.label, { color: colors.text }]}>
            Location
          </ThemedText>
          <View>
            <View style={styles.addressContainer}>
              <View>
                <ThemedText style={[styles.link, { color: colors.link }]}>
                  {venueConfig.name}
                </ThemedText>
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

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
            Venue Time Zone
          </ThemedText>
          <ThemedText style={[styles.sectionText, { color: colors.text }]}>
            Eastern Time
          </ThemedText>
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.section}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
            Disclaimer
          </ThemedText>
          <ThemedText style={[styles.sectionText, { color: colors.text }]}>
            MeetCal is in no way affiliated with USA Weightlifting. All of the information on this app is accurate based on the information provided by the event organizers. 
            The event organizers can and do occasionally change the location of sessions, please check their Instagram 
            for any platform changes.
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
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
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  mainTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionText: {
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    fontSize: 16,
    marginBottom: 4,
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
}); 