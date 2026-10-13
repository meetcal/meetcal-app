/**
 * The imperative toast handle, apart from the animated host in
 * `components/ui/Toast.tsx`, so policy code (`utils/authGuard.ts`, the
 * premium gate) can raise a toast without importing Reanimated. The host
 * registers itself here while mounted; `components/ui/Toast` re-exports
 * `showToast` for the screens that already import it from there.
 */
export type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  type: ToastType;
  message: string;
  /** Auto-dismiss delay in ms. Defaults to 3500 (6000 for errors). */
  duration?: number;
}

/** How a toast reached a host. */
export interface ToastDelivery {
  /**
   * Passed down by a host that is leaving (a modal closing) after it had
   * already shown the toast: no second haptic or screen-reader announcement.
   */
  alreadyAnnounced: boolean;
}

type ToastHandler = (options: ToastOptions, delivery?: ToastDelivery) => void;

/**
 * Mounted hosts, newest last. The root layout mounts one; a modal mounts its
 * own while open, because a React Native `Modal` is a separate native window
 * above the root view and a toast from the root host would sit behind it.
 * The newest host gets each toast.
 */
const handlers: ToastHandler[] = [];

/** A mounted host registers here; returns the unregister function. */
export function registerToastHandler(handler: ToastHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/**
 * A host is unmounting with a toast still on screen (its modal closed in the
 * same update that raised the toast, e.g. "Added 3 sessions"). Show it on the
 * host below instead of losing it.
 */
export function handOffToast(options: ToastOptions, alreadyAnnounced: boolean): void {
  handlers[handlers.length - 1]?.(options, { alreadyAnnounced });
}

export const DEFAULT_TOAST_DURATION_MS = 3500;
export const ERROR_TOAST_DURATION_MS = 6000;
/**
 * With VoiceOver or TalkBack on, a toast stays at least this long: focus
 * reaches it slowly, and errors used to dismiss before the user got there.
 */
export const SCREEN_READER_MIN_TOAST_DURATION_MS = 10000;

export function toastDurationMs(options: ToastOptions, isScreenReaderEnabled: boolean): number {
  const base =
    options.duration ??
    (options.type === "error" ? ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS);
  return isScreenReaderEnabled ? Math.max(base, SCREEN_READER_MIN_TOAST_DURATION_MS) : base;
}

/**
 * Imperative helper usable from anywhere (including non-component code).
 * Requires a mounted <ToastProvider> in the tree.
 */
export function showToast(options: ToastOptions) {
  const handler = handlers[handlers.length - 1];
  if (handler) {
    handler(options);
  } else if (__DEV__) {
    console.warn("showToast called before ToastProvider was mounted");
  }
}
