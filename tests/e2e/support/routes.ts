export const publicRoutes = [
  ["/", "Your Competition Schedule, Simplified"],
  ["/atlas", "Meet history and athlete data, connected"],
  ["/features", "Everything you need before the bar is loaded"],
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Use"],
  ["/subscription", "Continue in the MeetCal app"],
] as const;

export const protectedDataRoutes = [
  "/comp-data",
  "/qualifying-totals",
  "/standards",
  "/results",
  "/rankings",
  "/national-rankings",
  "/records",
  "/wso-records",
  "/adaptive-records",
  "/meet-center",
  "/club-dashboard",
  "/wso-dashboard",
  "/wrapped",
] as const;
