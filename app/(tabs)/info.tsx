import { StyleSheet, View, Linking, Pressable, Platform } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { venueConfig, getFullAddress } from '@/config/venue';

export default function InfoScreen() {
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
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        {/* Venue Info */}
        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>Venue Information</ThemedText>
          
          <View style={styles.section}>
            <ThemedText style={styles.label}>Location</ThemedText>
            <ThemedText style={styles.value}>{venueConfig.name}</ThemedText>
          </View>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              pressed && styles.sectionPressed
            ]}
            onPress={handleAddressPress}
          >
            <ThemedText style={styles.label}>Address</ThemedText>
            <View style={styles.addressContainer}>
              <View>
                <ThemedText style={styles.link}>{venueConfig.address.street}</ThemedText>
                <ThemedText style={styles.link}>
                  {venueConfig.address.city}, {venueConfig.address.state} {venueConfig.address.zip}
                </ThemedText>
              </View>
              <IconSymbol name="chevron.right" size={20} color="#007AFF" />
            </View>
          </Pressable>
        </View>

        {/* USAW Contact */}
        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>USAW Contact</ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && styles.sectionPressed
            ]}
            onPress={() => handlePress('mailto:events@usaweightlifting.org')}
          >
            <ThemedText style={styles.label}>Email</ThemedText>
            <View style={styles.linkRow}>
              <ThemedText style={styles.link}>events@usaweightlifting</ThemedText>
              <IconSymbol name="chevron.right" size={20} color="#007AFF" />
            </View>
          </Pressable>
        </View>

        {/* App Support */}
        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>App Support</ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && styles.sectionPressed
            ]}
            onPress={() => handlePress('mailto:memohnsen@gmail.com')}
          >
            <ThemedText style={styles.label}>Contact</ThemedText>
            <View style={styles.linkRow}>
              <ThemedText style={styles.link}>memohnsen@gmail.com</ThemedText>
              <IconSymbol name="chevron.right" size={20} color="#007AFF" />
            </View>
          </Pressable>
        </View>

        {/* Other Projects */}
        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>See Our Other Projects</ThemedText>
          
          <Pressable
            style={({ pressed }) => [
              styles.section,
              styles.lastSection,
              pressed && styles.sectionPressed
            ]}
            onPress={() => handlePress('https://wl-wargames.com')}
          >
            <ThemedText style={styles.label}>Competition Simulator</ThemedText>
            <View style={styles.linkRow}>
              <ThemedText style={styles.link}>War Games</ThemedText>
              <IconSymbol name="chevron.right" size={20} color="#007AFF" />
            </View>
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
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
    borderBottomColor: '#E1E1E1',
  },
  lastSection: {
    borderBottomWidth: 0,
  },
  sectionPressed: {
    backgroundColor: '#F5F5F5',
  },
  label: {
    fontSize: 15,
    color: '#6B6B6B',
    marginBottom: 4,
  },
  value: {
    fontSize: 17,
    color: '#000000',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: {
    fontSize: 17,
    color: '#007AFF',
  },
  addressContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
}); 