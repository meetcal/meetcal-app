// Update the sponsor type
export interface Sponsor {
    id: string; 
    name: string;
    description: string;
    website: string;
    discount?: string;
    image: any; // Add image property
  };