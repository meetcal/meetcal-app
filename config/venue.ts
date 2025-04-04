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
  'Florida WSO Champs': {
    name: 'Lake Wales High School',
    address: {
      street: '1 Highlander Way',
      city: 'Lake Wales',
      state: 'FL',
      zip: '33853',
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