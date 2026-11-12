import { devLog } from '@/lib/logger';
import { useRedirectIntoTabs } from '@/hooks/useRedirectIntoTabs';

export default function NotFoundScreen() {
  devLog('[NotFound] Hit +not-found route, returning to /(tabs)/(index)');
  useRedirectIntoTabs('/(tabs)/(index)');
  return null;
}
