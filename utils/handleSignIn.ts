import { useSubscription } from "@/contexts/SubscriptionContext";
import { cacheAuthState } from "@/lib/authCache";
import * as AuthSession from "expo-auth-session";
import * as Updates from "expo-updates";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import * as Sentry from "@sentry/react-native";

type OAuthProvider = "google" | "apple";
type OAuthStrategy = "oauth_google" | "oauth_apple";
type SSOFlowResult = {
  createdSessionId: string | null;
  setActive?: ((value: { session: string }) => Promise<void>) | null;
  authSessionResult?: { type?: string } | null;
};
type OAuthFlowMeta = {
  provider: OAuthProvider;
  strategy: OAuthStrategy;
  primaryRedirectUrl: string;
  fallbackRedirectUrl: string;
  usedFallback: boolean;
};
type OAuthErrorWithMeta = Error & {
  oauthMeta?: OAuthFlowMeta;
};

const OAUTH_PRIMARY_CALLBACK_PATH = "oauth-native-callback";
const OAUTH_FALLBACK_CALLBACK_PATH = "sso-callback";
const CLERK_MISSING_REDIRECT_ERROR =
  "Missing external verification redirect URL for SSO flow";

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
          from: from || "/(tabs)/(index)",
          feature: feature,
        },
      } as any);
    } else if (from && from !== "feature") {
      // Return to origin
      router.replace(from as any);
    } else {
      // Default to tabs
      router.replace("/(tabs)/(index)" as any);
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
    options: { provider: OAuthProvider; strategy: OAuthStrategy; context: "sign-in" },
  ) => {
    console.error("OAuth provider:", options.provider);
    console.error("OAuth strategy:", options.strategy);
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

    const errorMeta =
      typeof err === "object" && err !== null && "oauthMeta" in err
        ? (err as OAuthErrorWithMeta).oauthMeta
        : undefined;

    Sentry.withScope((scope) => {
      scope.setTag("auth.provider", options.provider);
      scope.setTag("auth.strategy", options.strategy);
      scope.setTag("auth.context", options.context);
      scope.setContext("oauth_sso", {
        release: Updates.runtimeVersion ?? "unknown",
        updateId: Updates.updateId ?? "embedded",
        primaryRedirectUrl: errorMeta?.primaryRedirectUrl ?? "unknown",
        fallbackRedirectUrl: errorMeta?.fallbackRedirectUrl ?? "unknown",
        usedFallback: errorMeta?.usedFallback ?? false,
      });
      Sentry.captureException(err);
    });
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
      await cacheAuthState(true);
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
      const primaryRedirectUrl = AuthSession.makeRedirectUri({
        scheme: "meetcal",
        path: OAUTH_PRIMARY_CALLBACK_PATH,
      });
      const fallbackRedirectUrl = AuthSession.makeRedirectUri({
        scheme: "meetcal",
        path: OAUTH_FALLBACK_CALLBACK_PATH,
      });
      let redirectUrl = primaryRedirectUrl;
      let usedFallback = false;

      console.log("Redirect URL:", primaryRedirectUrl);
      console.log("Calling startSSOFlow...");
      let result: SSOFlowResult;
      try {
        result = await startSSOFlow({
          strategy,
          redirectUrl: primaryRedirectUrl,
        });
      } catch (initialErr) {
        const initialMessage = (initialErr as Error)?.message ?? "";
        if (!initialMessage.includes(CLERK_MISSING_REDIRECT_ERROR)) {
          if (typeof initialErr === "object" && initialErr !== null) {
            (initialErr as OAuthErrorWithMeta).oauthMeta = {
              provider,
              strategy,
              primaryRedirectUrl,
              fallbackRedirectUrl,
              usedFallback,
            };
          }
          throw initialErr;
        }

        usedFallback = true;
        redirectUrl = fallbackRedirectUrl;
        console.warn(
          "Retrying SSO flow with fallback redirect URL:",
          fallbackRedirectUrl,
        );
        try {
          result = await startSSOFlow({
            strategy,
            redirectUrl: fallbackRedirectUrl,
          });
        } catch (retryErr) {
          if (typeof retryErr === "object" && retryErr !== null) {
            (retryErr as OAuthErrorWithMeta).oauthMeta = {
              provider,
              strategy,
              primaryRedirectUrl,
              fallbackRedirectUrl,
              usedFallback,
            };
          }
          throw retryErr;
        }
      }

      console.log("SSO Flow Result:", safeStringify(result));

      if (result.createdSessionId) {
        console.log("Session created directly:", result.createdSessionId);
        await setActiveSession(result, result.createdSessionId, provider);
        handlePostSignIn();
        return;
      }

      const authSessionResultType = result.authSessionResult?.type;
      const noSessionError = new Error(
        authSessionResultType
          ? `No session created for ${provider} SSO (authSessionResult: ${authSessionResultType})`
          : `No session created for ${provider} SSO`,
      ) as OAuthErrorWithMeta;
      noSessionError.oauthMeta = {
        provider,
        strategy,
        primaryRedirectUrl,
        fallbackRedirectUrl,
        usedFallback,
      };
      if (authSessionResultType === "cancel") {
        throw noSessionError;
      }
      throw noSessionError;
    },
    [handlePostSignIn, safeStringify, setActiveSession],
  );

  const onGooglePress = useCallback(
    async (startSSOFlow: any) => {
      try {
        await performSSOFlow(startSSOFlow, "oauth_google", "google");
      } catch (err) {
        handleOAuthError(err, {
          provider: "google",
          strategy: "oauth_google",
          context: "sign-in",
        });
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
        handleOAuthError(err, {
          provider: "apple",
          strategy: "oauth_apple",
          context: "sign-in",
        });
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
