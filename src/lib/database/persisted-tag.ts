import * as Application from 'expo-application';
import * as Updates from 'expo-updates';

const SEPARATOR = '\u0000';

export function runningBundleIdentity(): string {
  return [Updates.updateId ?? 'embedded', Application.nativeBuildVersion ?? '', Application.nativeApplicationVersion ?? ''].join(
    ':',
  );
}

export function encodePersistedTag(tag: string | null | undefined, bundle: string = runningBundleIdentity()): string | undefined {
  if (typeof tag !== 'string' || tag.length === 0) return undefined;
  return `${bundle}${SEPARATOR}${tag}`;
}

export function decodePersistedTag(stored: unknown, bundle: string = runningBundleIdentity()): string | null {
  if (typeof stored !== 'string') return null;
  const separator = stored.indexOf(SEPARATOR);
  if (separator < 0) return null;
  if (stored.slice(0, separator) !== bundle) return null;
  const tag = stored.slice(separator + 1);
  return tag.length > 0 ? tag : null;
}
