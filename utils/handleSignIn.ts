import { useSubscription } from "@/contexts/SubscriptionContext";
import * as AuthSession from "expo-auth-session";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";

type OAuthProvider = "google" | "apple";
type OAuthStrategy = "oauth_google" | "oauth_apple";

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

  const handleOAuthError = (
    err: unknown,
    options: { provider: OAuthProvider; context: "sign-in" },
  ) => {
    console.error("OAuth provider:", options.provider);
    console.error("OAuth context:", options.context);
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
  };

  const setActiveSession = useCallback(
    async (
      result: { setActive?: ((value: { session: string }) => Promise<void>) | null },
      sessionId: string,
      provider: OAuthProvider,
    ) => {
      if (typeof result?.setActive !== "function") {
        throw new Error(
          `Unable to activate ${provider} session because setActive is unavailable`,
        );
      }

      await result.setActive({ session: sessionId });
    },
    [],
  );

  const performSSOFlow = useCallback(
    async (
      startSSOFlow: any,
      strategy: OAuthStrategy,
      provider: OAuthProvider,
    ) => {
      console.log(`Starting ${provider} OAuth flow...`);
      const redirectUrl = AuthSession.makeRedirectUri({
        scheme: "meetcal",
        path: "oauth-native-callback",
      });
      console.log("Redirect URL:", redirectUrl);

      console.log("Calling startSSOFlow...");
      const result = await startSSOFlow({
        strategy,
        redirectUrl,
      });
      console.log("SSO Flow Result:", safeStringify(result));

      if (result.createdSessionId) {
        console.log("Session created directly:", result.createdSessionId);
        await setActiveSession(result, result.createdSessionId, provider);
        handlePostSignIn();
        return;
      }

      if (result.signUp) {
        console.log("Sign up flow initiated:", result.signUp.status);
        const signUp = result.signUp;

        try {
          console.log("Attempting to complete sign up...");
          await signUp.update({
            emailAddress: signUp.emailAddress || "",
            firstName: signUp.firstName || "",
            lastName: signUp.lastName || "",
            legalAccepted: true,
          });

          const completeSignUp = await signUp.create({
            strategy,
            redirectUrl,
            transfer: true,
          });

          console.log("Sign up completion result:", safeStringify(completeSignUp));

          if (completeSignUp.createdSessionId) {
            console.log(
              "Session created after sign up:",
              completeSignUp.createdSessionId,
            );
            await setActiveSession(result, completeSignUp.createdSessionId, provider);
            handlePostSignIn();
            return;
          }

          console.log("No session created after sign up completion");
          if (result.signIn && signUp.emailAddress) {
            const signInAttempt = await result.signIn.create({
              identifier: signUp.emailAddress,
              strategy,
              redirectUrl,
            });

            if (signInAttempt.createdSessionId) {
              await setActiveSession(result, signInAttempt.createdSessionId, provider);
              handlePostSignIn();
              return;
            }
          }

          throw new Error("No session created after sign-up completion");
        } catch (signUpErr) {
          throw signUpErr;
        }
      }

      if (result.signIn) {
        console.log("Sign in flow initiated:", result.signIn.status);
        const signInAttempt = await result.signIn.create({
          strategy,
          redirectUrl,
        });

        if (signInAttempt.createdSessionId) {
          console.log("Session created from sign in:", signInAttempt.createdSessionId);
          await setActiveSession(result, signInAttempt.createdSessionId, provider);
          handlePostSignIn();
          return;
        }

        throw new Error("No session created from sign in");
      }

      throw new Error("Unexpected OAuth flow state");
    },
    [handlePostSignIn, safeStringify, setActiveSession],
  );

  const onGooglePress = useCallback(
    async (startSSOFlow: any) => {
      try {
        await performSSOFlow(startSSOFlow, "oauth_google", "google");
      } catch (err) {
        handleOAuthError(err, { provider: "google", context: "sign-in" });
        throw err;
      }
    },
    [performSSOFlow],
  );

  const onApplePress = useCallback(
    async (startSSOFlow: any) => {
      try {
        await performSSOFlow(startSSOFlow, "oauth_apple", "apple");
      } catch (err) {
        handleOAuthError(err, { provider: "apple", context: "sign-in" });
        throw err;
      }
    },
    [performSSOFlow],
  );

  return {
    onGooglePress,
    onApplePress,
  };
}
