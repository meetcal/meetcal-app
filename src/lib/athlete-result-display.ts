import type { AppColors } from "@/constants/Colors";
import type { AthleteMeetResult } from "@/types/athlete-results";

export const MIDDLING_RATE_COLOR = "#FF9500";
const GOOD_RATE_MIN = 80;
const POOR_RATE_BELOW = 70;

export function formatResultDate(date: string | null | undefined): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { timeZone: "UTC" });
}

export function getRateColor(
  rate: number,
  colors: Pick<AppColors, "success" | "fail">,
): string {
  if (rate >= GOOD_RATE_MIN) return colors.success;
  if (rate < POOR_RATE_BELOW) return colors.fail;
  return MIDDLING_RATE_COLOR;
}

export function meetResultKey(result: AthleteMeetResult, index: number): string {
  return `${result.event_id}-${result.meet}-${result.date}-${result.name}-${index}`;
}
