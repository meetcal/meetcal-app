import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSignIn, useSignUp } from "@clerk/clerk-expo";
import { cacheAuthState } from "@/lib/authCache";
import * as AuthSession from "expo-auth-session";
import * as Updates from "expo-updates";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import * as Sentry from "@sentry/react-native";
import * as WebBrowser from "expo-web-browser";

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
  manualFallbackUsed: boolean;
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
  const {
    signIn,
    setActive: clerkSetActive,
    isLoaded: isSignInLoaded,
  } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();
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

  const handleOAuthError = (
    err: unknown,
    options: { provider: OAuthProvider; strategy: OAuthStrategy; context: "sign-in" },
  ) => {
    const errorName = (err as Error)?.name ?? "Error";
    const errorMessage = (err as Error)?.message ?? "OAuth flow failed";
    console.error(
      "OAuth flow failed:",
      JSON.stringify({
        provider: options.provider,
        strategy: options.strategy,
        context: options.context,
        errorName,
        errorMessage,
      }),
    );

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
        manualFallbackUsed: errorMeta?.manualFallbackUsed ?? false,
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

  const performManualOAuthFallback = useCallback(
    async (strategy: OAuthStrategy, redirectUrl: string, provider: OAuthProvider) => {
      if (!isSignInLoaded || !isSignUpLoaded) {
        throw new Error(
          `Manual ${provider} OAuth fallback unavailable because Clerk is not loaded`,
        );
      }

      await signIn.create({
        strategy,
        redirectUrl,
      });

      if (signIn.createdSessionId) {
        return {
          createdSessionId: signIn.createdSessionId,
          setActive: clerkSetActive ?? null,
          authSessionResult: { type: "success" as const },
        } satisfies SSOFlowResult;
      }

      const { externalVerificationRedirectURL } = signIn.firstFactorVerification;
      if (!externalVerificationRedirectURL) {
        throw new Error(
          `Manual ${provider} OAuth fallback missing external verification redirect URL`,
        );
      }

      const authSessionResult = await WebBrowser.openAuthSessionAsync(
        externalVerificationRedirectURL.toString(),
        redirectUrl,
      );
      if (authSessionResult.type !== "success" || !authSessionResult.url) {
        return {
          createdSessionId: null,
          setActive: clerkSetActive ?? null,
          authSessionResult,
        } satisfies SSOFlowResult;
      }

      const params = new URL(authSessionResult.url).searchParams;
      const rotatingTokenNonce = params.get("rotating_token_nonce") ?? "";
      await signIn.reload({ rotatingTokenNonce });

      const userNeedsToBeCreated =
        signIn.firstFactorVerification.status === "transferable";
      if (userNeedsToBeCreated) {
        await signUp.create({
          transfer: true,
        });
      }

      return {
        createdSessionId: signUp.createdSessionId ?? signIn.createdSessionId ?? null,
        setActive: clerkSetActive ?? null,
        authSessionResult,
      } satisfies SSOFlowResult;
    },
    [clerkSetActive, isSignInLoaded, isSignUpLoaded, signIn, signUp],
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
      let manualFallbackUsed = false;

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
              manualFallbackUsed,
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
              manualFallbackUsed,
            };
          }
          const retryMessage = (retryErr as Error)?.message ?? "";
          if (!retryMessage.includes(CLERK_MISSING_REDIRECT_ERROR)) {
            throw retryErr;
          }

          manualFallbackUsed = true;
          console.warn("Retrying with manual Clerk OAuth fallback");
          try {
            result = await performManualOAuthFallback(
              strategy,
              fallbackRedirectUrl,
              provider,
            );
          } catch (manualErr) {
            if (typeof manualErr === "object" && manualErr !== null) {
              (manualErr as OAuthErrorWithMeta).oauthMeta = {
                provider,
                strategy,
                primaryRedirectUrl,
                fallbackRedirectUrl,
                usedFallback,
                manualFallbackUsed,
              };
            }
            throw manualErr;
          }
        }
      }

      if (result.createdSessionId) {
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
        manualFallbackUsed,
      };
      if (authSessionResultType === "cancel") {
        throw noSessionError;
      }
      throw noSessionError;
    },
    [handlePostSignIn, performManualOAuthFallback, setActiveSession],
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
