import { Redirect } from 'expo-router';
import { devLog } from '@/lib/logger';


export default function NotFoundScreen() {
  devLog('[NotFound] Hit +not-found route, redirecting to /(tabs)/(index)');
  return (
    <Redirect href="/(tabs)/(index)" />
  );
}
