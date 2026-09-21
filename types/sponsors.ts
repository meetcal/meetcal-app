import type { ImageSourcePropType } from "react-native";

// Update the sponsor type
export interface Sponsor {
    id: string; 
    name: string;
    description: string;
    website: string;
    discount?: string;
    image: ImageSourcePropType;
  };