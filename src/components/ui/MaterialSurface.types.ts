import type { ViewProps } from "react-native";

export interface MaterialSurfaceProps extends ViewProps {
  fallbackColor: string;
  intensity?: number;
}
