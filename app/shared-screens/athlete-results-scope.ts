import { MeetName } from "@/data/types/meet";

export function resolveAthleteResultsMeetScope(
  routeMeet: MeetName | string | string[] | undefined,
  selectedMeet: MeetName | null,
): MeetName | null {
  const parsedRouteMeet = Array.isArray(routeMeet) ? routeMeet[0] : routeMeet;
  if (parsedRouteMeet && parsedRouteMeet.trim().length > 0) {
    return parsedRouteMeet as MeetName;
  }
  return selectedMeet;
}
