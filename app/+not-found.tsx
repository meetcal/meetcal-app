import { Redirect } from 'expo-router';


export default function NotFoundScreen() {
  if (__DEV__) {
    console.log('[NotFound] Hit +not-found route, redirecting to /(tabs)/(index)');
  }
  return (
    <Redirect href="/(tabs)/(index)" />
  );
}
