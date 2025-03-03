export const venueConfig = {
  name: 'Georgia International Convention Center',
  address: {
    street: '2000 Convention Center Concourse',
    city: 'College Park',
    state: 'GA',
    zip: '30337',
  },
  // Add any other venue-specific info here
};

// Helper function to get full address string
export function getFullAddress() {
  const { street, city, state, zip } = venueConfig.address;
  return `${street}, ${city}, ${state} ${zip}`;
}

// Helper function to get location string with name and address
export function getFullLocation() {
  return `${venueConfig.name}, ${getFullAddress()}`;
} 