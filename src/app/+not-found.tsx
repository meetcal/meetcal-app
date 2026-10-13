import { DismissToRedirect } from '@/components/navigation/DismissToRedirect';
import { devLog } from '@/lib/logger';


export default function NotFoundScreen() {
  devLog('[NotFound] Hit +not-found route, returning to /(tabs)/(index)');
  return <DismissToRedirect href="/(tabs)/(index)" />;
}
