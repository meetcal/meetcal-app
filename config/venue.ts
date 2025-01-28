export const venueConfig = {
  name: 'Greater Columbus Convention Center',
  address: {
    street: '400 N High St',
    city: 'Columbus',
    state: 'OH',
    zip: '43215',
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