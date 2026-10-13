import { IconSymbol } from "@/components/ui/IconSymbol";
import { Radius, Shadows, Spacing, Type } from "@/constants/Layout";
import { useAppColors } from "@/hooks/useAppColors";
import { errorNotification, successNotification } from "@/lib/haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Palette } from "@/constants/Palette";
import {
  handOffToast,
  registerToastHandler,
  toastDurationMs,
  type ToastDelivery,
  type ToastOptions,
  type ToastType,
} from "@/lib/toast";

export { showToast, type ToastOptions, type ToastType } from "@/lib/toast";

interface ToastData extends ToastOptions {
  id: number;
  alreadyAnnounced: boolean;
}

const HIDDEN_OFFSET = -200;

/**
 * Mounts the root toast host. Callers reach the toast imperatively through
 * `showToast`, so there is no context value to provide. A `Modal` mounts its
 * own `ToastHost` inside it: the root host renders behind a modal's native
 * window, where the toast was never seen.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToastHost />
    </>
  );
}

function getToastVisual(type: ToastType, colors: ReturnType<typeof useAppColors>) {
  switch (type) {
    case "success":
      return { backgroundColor: colors.success, icon: "checkmark.circle.fill" };
    case "error":
      return { backgroundColor: colors.danger, icon: "xmark.circle.fill" };
    case "info":
    default:
      return { backgroundColor: colors.link, icon: "info.circle.fill" };
  }
}

/** Whether VoiceOver / TalkBack is on, kept current. */
function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return enabled;
}

/**
 * Renders toasts while it is the newest mounted host. The root layout mounts
 * one through `ToastProvider`; mount another inside a `Modal`'s content so a
 * toast raised while the modal is open shows above it.
 */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const [toast, setToast] = useState<ToastData | null>(null);
  const isScreenReaderEnabled = useScreenReaderEnabled();
  // The toast on screen, for the hand-off when this host unmounts. Set in
  // `show` rather than from state: a modal that closes in the same update
  // that raised the toast unmounts this host before it ever renders it.
  const visibleToastRef = useRef<ToastData | null>(null);
  // The id of the last toast this host announced.
  const announcedIdRef = useRef(0);
  const translateY = useSharedValue(HIDDEN_OFFSET);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearToast = useCallback(() => {
    visibleToastRef.current = null;
    setToast(null);
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    translateY.value = withTiming(HIDDEN_OFFSET, { duration: 250 }, (finished) => {
      if (finished) {
        runOnJS(clearToast)();
      }
    });
  }, [clearTimer, clearToast, translateY]);

  const show = useCallback(
    (options: ToastOptions, delivery?: ToastDelivery) => {
      idRef.current += 1;
      // Replace any visible toast with the newest one.
      const next = {
        ...options,
        id: idRef.current,
        alreadyAnnounced: delivery?.alreadyAnnounced ?? false,
      };
      visibleToastRef.current = next;
      setToast(next);
    },
    [],
  );

  // Register the imperative handler while mounted. A modal's host that goes
  // away with a toast still showing passes it to the host below.
  useEffect(() => {
    const unregister = registerToastHandler(show);
    return () => {
      unregister();
      const visible = visibleToastRef.current;
      if (visible) {
        handOffToast(
          { type: visible.type, message: visible.message, duration: visible.duration },
          visible.alreadyAnnounced || announcedIdRef.current === visible.id,
        );
      }
    };
  }, [show]);

  // Animate + schedule auto-dismiss whenever a new toast is shown.
  useEffect(() => {
    if (!toast) return;

    announcedIdRef.current = toast.id;
    if (!toast.alreadyAnnounced) {
      if (toast.type === "success") {
        successNotification();
      } else if (toast.type === "error") {
        errorNotification();
      }
      // A view appearing is not announced on iOS (the "alert" role has no
      // speech of its own); Android announces through the live region below.
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(toast.message);
      }
    }

    translateY.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });

    clearTimer();
    timerRef.current = setTimeout(dismiss, toastDurationMs(toast, isScreenReaderEnabled));

    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        gesture.dy < -4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_evt, gesture) => {
        if (gesture.dy < 0) {
          translateY.value = gesture.dy;
        }
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy < -20) {
          dismiss();
        } else {
          translateY.value = withTiming(0, {
            duration: 200,
            easing: Easing.out(Easing.cubic),
          });
        }
      },
    }),
  ).current;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!toast) return null;

  const visual = getToastVisual(toast.type, colors);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        {
          paddingTop: insets.top + Spacing.xs,
          left: insets.left,
          right: insets.right,
        },
        animatedStyle,
      ]}
    >
      <Pressable
        {...panResponder.panHandlers}
        onPress={dismiss}
        accessibilityRole="alert"
        accessibilityLabel={toast.message}
        accessibilityHint="Double-tap to dismiss"
        accessibilityLiveRegion="assertive"
        style={[
          styles.banner,
          Shadows.card,
          { backgroundColor: visual.backgroundColor },
        ]}
      >
        <IconSymbol name={visual.icon} size={20} color="#FFFFFF" />
        <Text style={styles.message} numberOfLines={3}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    zIndex: 2000,
    elevation: 2000,
    alignItems: "center",
  },
  banner: {
    width: "100%",
    maxWidth: 500,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
  },
  message: {
    ...Type.bodySemiBold,
    color: Palette.white,
    flex: 1,
  },
});
