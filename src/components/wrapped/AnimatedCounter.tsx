import React, { useEffect, useState } from "react";
import { type StyleProp, Text, type TextStyle } from "react-native";
import { easedCounterValue, formatCounterValue } from "@/lib/wrapped-slide-copy";

export function AnimatedCounter({
  value,
  duration = 1500,
  delay = 300,
  suffix = "",
  decimals = 0,
  style,
}: {
  value: number;
  duration?: number;
  delay?: number;
  suffix?: string;
  decimals?: number;
  style?: StyleProp<TextStyle>;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const startTime = Date.now() + delay;
    let pendingFrame: number | null = null;

    const tick = () => {
      const now = Date.now();
      if (now < startTime) {
        pendingFrame = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min((now - startTime) / duration, 1);
      setDisplay(easedCounterValue(progress, value, decimals));
      pendingFrame = progress < 1 ? requestAnimationFrame(tick) : null;
    };
    pendingFrame = requestAnimationFrame(tick);

    return () => {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    };
  }, [value, duration, delay, decimals]);

  return <Text style={style}>
{formatCounterValue(display, decimals)}
{suffix}
</Text>;
}
