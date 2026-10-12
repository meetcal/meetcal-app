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

type ToastHandler = (options: ToastOptions) => void;

let activeHandler: ToastHandler | null = null;

/** The mounted host registers here; returns the unregister function. */
export function registerToastHandler(handler: ToastHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) {
      activeHandler = null;
    }
  };
}

/**
 * Imperative helper usable from anywhere (including non-component code).
 * Requires a mounted <ToastProvider> in the tree.
 */
export function showToast(options: ToastOptions) {
  if (activeHandler) {
    activeHandler(options);
  } else if (__DEV__) {
    console.warn("showToast called before ToastProvider was mounted");
  }
}
