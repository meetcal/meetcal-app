import { IconSymbol } from "@/components/ui/IconSymbol";
import { Radius, Shadows, Spacing, Type } from "@/constants/Layout";
import { useAppColors } from "@/hooks/useAppColors";
import * as Haptics from "expo-haptics";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { PanResponder, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  type: ToastType;
  message: string;
  /** Auto-dismiss delay in ms. Defaults to 3500 (6000 for errors). */
  duration?: number;
}

interface ToastData extends ToastOptions {
  id: number;
}

const DEFAULT_DURATION = 3500;
const ERROR_DURATION = 6000;
const HIDDEN_OFFSET = -200;

// Module-level handle so non-component code can trigger toasts.
let activeHandler: ((options: ToastOptions) => void) | null = null;

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

const ToastContext = createContext<(options: ToastOptions) => void>(showToast);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <ToastHost />
    </ToastContext.Provider>
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

function ToastHost() {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const [toast, setToast] = useState<ToastData | null>(null);
  const translateY = useSharedValue(HIDDEN_OFFSET);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    translateY.value = withTiming(HIDDEN_OFFSET, { duration: 250 }, (finished) => {
      if (finished) {
        runOnJS(setToast)(null);
      }
    });
  }, [clearTimer, translateY]);

  const show = useCallback(
    (options: ToastOptions) => {
      idRef.current += 1;
      // Replace any visible toast with the newest one.
      setToast({ ...options, id: idRef.current });
    },
    [],
  );

  // Register the imperative handler while mounted.
  useEffect(() => {
    activeHandler = show;
    return () => {
      if (activeHandler === show) {
        activeHandler = null;
      }
    };
  }, [show]);

  // Animate + schedule auto-dismiss whenever a new toast is shown.
  useEffect(() => {
    if (!toast) return;

    if (process.env.EXPO_OS === "ios") {
      if (toast.type === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (toast.type === "error") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }

    translateY.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });

    clearTimer();
    timerRef.current = setTimeout(
      dismiss,
      toast.duration ?? (toast.type === "error" ? ERROR_DURATION : DEFAULT_DURATION),
    );

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
      style={[styles.wrapper, { paddingTop: insets.top + Spacing.xs }, animatedStyle]}
    >
      <Pressable
        {...panResponder.panHandlers}
        onPress={dismiss}
        accessibilityRole="alert"
        accessibilityLabel={toast.message}
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
    color: "#FFFFFF",
    flex: 1,
  },
});
