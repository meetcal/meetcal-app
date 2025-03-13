// Define venue configurations
const venues = {
  'USAW Master\'s Nationals': {
    name: 'Georgia International Convention Center',
    address: {
      street: '2000 Convention Center Concourse',
      city: 'College Park',
      state: 'GA',
      zip: '30337',
    },
  },
  'USAMW Master\'s Nationals': {
    name: 'Boise Expo Center',
    address: {
      street: '5610 North Glenwood Street',
      city: 'Boise',
      state: 'ID',
      zip: '83714',
    },
  }
} as const;

// Export the venue type
export type VenueConfig = typeof venues[keyof typeof venues];

// Get venue config for a specific meet
export function getVenueConfig(meetName: keyof typeof venues): VenueConfig {
  return venues[meetName] || venues['USAW Master\'s Nationals'];
}

// For backward compatibility
export const venueConfig = venues['USAW Master\'s Nationals'];

// Helper function to get full address string
export function getFullAddress(venue: VenueConfig = venueConfig) {
  const { street, city, state, zip } = venue.address;
  return `${street}, ${city}, ${state} ${zip}`;
}

// Helper function to get location string with name and address
export function getFullLocation(venue: VenueConfig = venueConfig) {
  return `${venue.name}, ${getFullAddress(venue)}`;
} 