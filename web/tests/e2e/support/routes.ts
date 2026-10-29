export const publicRoutes = [
  ["/", "Your Competition Schedule, Simplified"],
  ["/features", "Everything you need before the bar is loaded"],
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Use"],
  ["/subscription", "Continue in the MeetCal app"],
  // The one free data page: open to everyone, signed out included.
  ["/wrapped", "Athlete Wrapped"],
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
  "/wso-elite",
] as const;

/**
 * Pages that need a signed-in user but no subscription, with the heading a
 * signed-out visitor sees. `/link` approves a `meetcal login` from the CLI.
 */
export const signedInRoutes = [["/link", "Sign in to continue"]] as const;
