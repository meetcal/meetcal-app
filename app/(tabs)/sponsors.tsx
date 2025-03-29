import { StyleSheet, View, ScrollView, Pressable, Linking, Image, Platform } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useTheme } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { posthog } from '@/lib/posthog';

// Update the sponsor type
type Sponsor = {
  id: string;
  name: string;
  description: string;
  website: string;
  discount?: string;
  image: any; // Add image property
};

const sponsors: Sponsor[] = [
  {
    id: '1',
    name: 'War Games',
    description: 'Weightlifting Competition Simulator',
    website: 'https://wl-wargames.com',
    discount: 'Use code MEETCAL20 for 20% off!',
    image: require('@/assets/images/wg-ad.png') // Use your image
  },
  {
    id: '2',
    name: 'Power & Grace Performance',
    description: 'Data Driven Programming, Nation Wide',
    website: 'https://powerandgraceperformance.com/programming-2/',
    discount: 'Team Support, and Coaching Education',
    image: require('@/assets/images/powergrace.png') // Use your image
  },
  // {
  //   id: '3',
  //   name: 'Virus',
  //   description: 'The Official Apparel Sponsor of USA Weightlifting',
  //   website: 'https://virusintl.com',
  //   discount: 'Stop by the booth for 10% off!',
  //   image: require('@/assets/images/virus.png') // Use your image
  // },
  // {
  //   id: '4',
  //   name: 'Onyx Straps',
  //   description: 'The Gear For Weightlifters, By Weightlifters',
  //   website: 'https://onyxstraps.com',
  //   discount: 'Stop by the booth for BOGO straps!',
  //   image: require('@/assets/images/onyx.png') // Use your image
  // },
];

const NoImage = () => (
  <View style={styles.noImage}>
    <ThemedText style={styles.noImageText}>No Image</ThemedText>
  </View>
);

export default function SponsorsScreen() {
  const { currentTheme } = useTheme();
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
    gold: '#FFD700',
    silver: '#C0C0C0',
    bronze: '#CD7F32',
  };

  const handleOpenWebsite = (url: string, sponsorName: string) => {
    // Track the sponsor click event
    posthog.capture('sponsor_clicked', {
      sponsor_name: sponsorName,
      sponsor_url: url
    });
    
    // Open the website
    Linking.openURL(url);
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{
          headerTitle: 'Sponsors',
          headerTitleStyle: {
            color: colors.text,
          },
          headerStyle: {
            backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
          },
          headerShadowVisible: false,
        }}
      />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 20 }
        ]}
      >
        
        <ThemedText style={[styles.subHeaderText, { color: colors.secondaryText }]}>
          Support the businesses that support weightlifting
        </ThemedText>
        
        {sponsors.map((sponsor) => (
          <Pressable 
            key={sponsor.id} 
            style={({ pressed }) => [
              styles.sponsorCard, 
              { backgroundColor: colors.card },
              pressed && { backgroundColor: colors.pressed }
            ]}
            onPress={() => handleOpenWebsite(sponsor.website, sponsor.name)}
          >
            <Image 
              source={sponsor.image}
              style={styles.sponsorImage}
              resizeMode="cover"
            />
            <View style={styles.cardContent}>
              <View style={styles.textContent}>
                <ThemedText style={[styles.sponsorName, { color: colors.text }]}>
                  {sponsor.name}
                </ThemedText>
                <ThemedText 
                  style={[styles.description, { color: colors.secondaryText }]}
                  numberOfLines={2}
                >
                  {sponsor.description}
                </ThemedText>
                <ThemedText 
                  style={[styles.description, { color: colors.secondaryText }]}
                  numberOfLines={1}
                >
                  {sponsor.discount}
                </ThemedText>
              </View>
              <IconSymbol 
                name="chevron.right" 
                size={20} 
                color={colors.secondaryText} 
              />
            </View>
          </Pressable>
        ))}
        
        <ThemedText style={[styles.footerText, { color: colors.secondaryText }]}>
          Interested in sponsoring? Contact us at maddisen@meetcal.app
        </ThemedText>
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
  scrollContent: {
    padding: 16,
  },
  headerText: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subHeaderText: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  sponsorCard: {
    borderRadius: 12,
    marginBottom: 16,
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
  noImage: {
    height: 160,
    backgroundColor: '#E5E5E5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImageText: {
    fontSize: 16,
    color: '#999999',
  },
  sponsorImage: {
    width: '100%',
    height: 160,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  textContent: {
    flex: 1,
    marginRight: 12,
  },
  sponsorName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  description: {
    fontSize: 15,
    lineHeight: 20,
  },
  footerText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 40,
  },
}); 