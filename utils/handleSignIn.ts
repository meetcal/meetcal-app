import { useSubscription } from "@/contexts/SubscriptionContext";
import * as AuthSession from "expo-auth-session";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";

// Export a hook that components can use
export function useSignInHandlers() {
  const { isSubscribed } = useSubscription();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();

  const handlePostSignIn = useCallback(() => {
    if (!isSubscribed) {
      // User needs subscription - redirect to paywall with context
      router.replace({
        pathname: "/shared-screens/paywall",
        params: {
          from: from || "/(tabs)",
          feature: feature,
        },
      } as any);
    } else if (from && from !== "feature") {
      // Return to origin
      router.replace(from as any);
    } else {
      // Default to tabs
      router.replace("/(tabs)" as any);
    }
  }, [from, feature, isSubscribed]);

  // Helper functions
  const safeStringify = (value: unknown) => {
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val as object)) return "[Circular]";
          seen.add(val as object);
        }
        return val;
      });
    } catch (stringifyError) {
      return `<<unstringifiable: ${String(stringifyError)}>>`;
    }
  };

  const dumpErrorDetails = (value: unknown) => {
    try {
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);
        const allKeys = Object.getOwnPropertyNames(obj);
        console.error("OAuth error keys:", keys);
        console.error("OAuth error all keys:", allKeys);
        allKeys.forEach((key) => {
          try {
            console.error(`OAuth error prop ${key}:`, obj[key]);
          } catch (propErr) {
            console.error(`OAuth error prop ${key} (read error):`, propErr);
          }
        });
      }
    } catch (dumpErr) {
      console.error("OAuth error dump failed:", dumpErr);
    }
  };

  // Handle Google OAuth
  const onGooglePress = useCallback(
    async (startSSOFlow: any) => {
      try {
        console.log("Starting Google OAuth flow...");
        const redirectUrl = AuthSession.makeRedirectUri({
          scheme: "meetcal",
          path: "oauth-native-callback",
        });
        console.log("Redirect URL:", redirectUrl);

        console.log("Calling startSSOFlow...");
        const result = await startSSOFlow({
          strategy: "oauth_google",
          redirectUrl,
        });
        console.log("SSO Flow Result:", safeStringify(result));

        if (result.createdSessionId) {
          console.log("Session created directly:", result.createdSessionId);
          await result.setActive!({ session: result.createdSessionId });
          handlePostSignIn();
        } else if (result.signUp) {
          console.log("Sign up flow initiated:", result.signUp.status);
          const signUp = result.signUp;

          try {
            console.log("Attempting to complete sign up...");

            // First, update the sign-up with required fields
            await signUp.update({
              emailAddress: signUp.emailAddress || "",
              firstName: signUp.firstName || "",
              lastName: signUp.lastName || "",
              password: Math.random().toString(36).slice(-8),
              legalAccepted: true,
            });

            // Then complete the sign-up
            const completeSignUp = await signUp.create({
              strategy: "oauth_google",
              redirectUrl,
              transfer: true,
            });

            console.log(
              "Sign up completion result:",
              JSON.stringify(completeSignUp, null, 2),
            );

            if (completeSignUp.createdSessionId) {
              console.log(
                "Session created after sign up:",
                completeSignUp.createdSessionId,
              );
              await result.setActive!({
                session: completeSignUp.createdSessionId,
              });
              handlePostSignIn();
            } else {
              console.log("No session created after sign up completion");
              if (result.signIn && signUp.emailAddress) {
                const signInAttempt = await result.signIn.create({
                  identifier: signUp.emailAddress,
                  strategy: "oauth_google",
                  redirectUrl,
                });

                if (signInAttempt.createdSessionId) {
                  await result.setActive!({
                    session: signInAttempt.createdSessionId,
                  });
                  handlePostSignIn();
                }
              }
            }
          } catch (signUpErr) {
            console.error("Sign up error:", JSON.stringify(signUpErr, null, 2));
          }
        } else if (result.signIn) {
          console.log("Sign in flow initiated:", result.signIn.status);
          const signIn = result.signIn;

          try {
            const signInAttempt = await signIn.create({
              strategy: "oauth_google",
              redirectUrl,
            });

            if (signInAttempt.createdSessionId) {
              console.log(
                "Session created from sign in:",
                signInAttempt.createdSessionId,
              );
              await result.setActive!({
                session: signInAttempt.createdSessionId,
              });
              handlePostSignIn();
            } else {
              console.log("No session created from sign in");
            }
          } catch (signInErr) {
            console.error("Sign in error:", JSON.stringify(signInErr, null, 2));
          }
        } else {
          console.log("Unexpected flow state:", JSON.stringify(result, null, 2));
        }
      } catch (err) {
        console.error("OAuth error (raw):", err);
        console.error("OAuth error (name):", (err as Error)?.name);
        console.error("OAuth error (message):", (err as Error)?.message);
        console.error("OAuth error (stack):", (err as Error)?.stack);
        try {
          console.error("OAuth error (string):", String(err));
        } catch (toStringError) {
          console.error("OAuth error (string error):", toStringError);
        }
        console.error("OAuth error (safe json):", safeStringify(err));
        dumpErrorDetails(err);
      }
    },
    [handlePostSignIn],
  );

  // Handle Apple OAuth
  const onApplePress = useCallback(
    async (startSSOFlow: any) => {
      try {
        console.log("Starting Apple OAuth flow...");
        const redirectUrl = AuthSession.makeRedirectUri({
          scheme: "meetcal",
          path: "oauth-native-callback",
        });
        console.log("Redirect URL:", redirectUrl);

        console.log("Calling startSSOFlow...");
        const result = await startSSOFlow({
          strategy: "oauth_apple",
          redirectUrl,
        });
        console.log("SSO Flow Result:", JSON.stringify(result, null, 2));

        if (result.createdSessionId) {
          console.log("Session created directly:", result.createdSessionId);
          await result.setActive!({ session: result.createdSessionId });
          handlePostSignIn();
        } else if (result.signUp) {
          console.log("Sign up flow initiated:", result.signUp.status);
          const signUp = result.signUp;

          try {
            console.log("Attempting to complete sign up...");

            await signUp.update({
              emailAddress: signUp.emailAddress || "",
              firstName: signUp.firstName || "",
              lastName: signUp.lastName || "",
              password: Math.random().toString(36).slice(-8),
              legalAccepted: true,
            });

            const completeSignUp = await signUp.create({
              strategy: "oauth_apple",
              redirectUrl,
              transfer: true,
            });

            console.log(
              "Sign up completion result:",
              JSON.stringify(completeSignUp, null, 2),
            );

            if (completeSignUp.createdSessionId) {
              console.log(
                "Session created after sign up:",
                completeSignUp.createdSessionId,
              );
              await result.setActive!({
                session: completeSignUp.createdSessionId,
              });
              handlePostSignIn();
            } else {
              console.log("No session created after sign up completion");
              if (result.signIn && signUp.emailAddress) {
                const signInAttempt = await result.signIn.create({
                  identifier: signUp.emailAddress,
                  strategy: "oauth_apple",
                  redirectUrl,
                });

                if (signInAttempt.createdSessionId) {
                  await result.setActive!({
                    session: signInAttempt.createdSessionId,
                  });
                  handlePostSignIn();
                }
              }
            }
          } catch (signUpErr) {
            console.error("Sign up error:", JSON.stringify(signUpErr, null, 2));
          }
        } else if (result.signIn) {
          console.log("Sign in flow initiated:", result.signIn.status);
          const signIn = result.signIn;

          try {
            const signInAttempt = await signIn.create({
              strategy: "oauth_apple",
              redirectUrl,
            });

            if (signInAttempt.createdSessionId) {
              console.log(
                "Session created from sign in:",
                signInAttempt.createdSessionId,
              );
              await result.setActive!({
                session: signInAttempt.createdSessionId,
              });
              handlePostSignIn();
            } else {
              console.log("No session created from sign in");
            }
          } catch (signInErr) {
            console.error("Sign in error:", JSON.stringify(signInErr, null, 2));
          }
        } else {
          console.log("Unexpected flow state:", JSON.stringify(result, null, 2));
        }
      } catch (err) {
        console.error("OAuth error:", JSON.stringify(err, null, 2));
      }
    },
    [handlePostSignIn],
  );

  return {
    onGooglePress,
    onApplePress,
  };
}
