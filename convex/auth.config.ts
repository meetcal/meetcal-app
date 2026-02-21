export default {
  providers: [
    {
      // Clerk issuer URL — set CLERK_ISSUER in Convex environment variables
      // Value: https://clerk.meetcal.app
      domain: process.env.CLERK_ISSUER!,
      applicationID: "convex",
    },
  ],
};
