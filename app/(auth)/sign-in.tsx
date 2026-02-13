import { IconSymbol } from "@/components/ui/IconSymbol";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useSSO } from "@clerk/clerk-expo";
import * as AuthSession from "expo-auth-session";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect } from "react";
import {
  Dimensions,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Warm up the browser for better performance
export const useWarmUpBrowser = () => {
  useEffect(() => {
    const warmUp = async () => {
      try {
        await WebBrowser.warmUpAsync();
      } catch (err) {
        // Some Android setups can't resolve a browser package; ignore.
        console.log("WebBrowser warmUp skipped:", err);
      }
    };
    void warmUp();
    return () => {
      const coolDown = async () => {
        try {
          await WebBrowser.coolDownAsync();
        } catch (err) {
          console.log("WebBrowser coolDown skipped:", err);
        }
      };
      void coolDown();
    };
  }, []);
};

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { startSSOFlow } = useSSO();
  const { currentTheme } = useTheme();
  const router = useRouter();
  const colors = useAppColors();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const isFromInfo = from === "info";
  const { isSubscribed } = useSubscription();

  useWarmUpBrowser();

  const handlePostSignIn = useCallback(() => {
    if (!isSubscribed) {
      // User needs subscription - redirect to paywall with context
      router.replace({
        pathname: "/(screens)/paywall",
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
  }, [from, feature, isSubscribed, router]);

  // Handle Google OAuth
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

  const onGooglePress = useCallback(async () => {
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
            password: Math.random().toString(36).slice(-8), // Generate a random password
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
            // If sign up didn't create a session, try to sign in
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
      // Many native errors aren't JSON-serializable; log safely.
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
  }, [handlePostSignIn]);

  // Handle Apple OAuth
  const onApplePress = useCallback(async () => {
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

          // First, update the sign-up with required fields
          await signUp.update({
            emailAddress: signUp.emailAddress || "",
            firstName: signUp.firstName || "",
            lastName: signUp.lastName || "",
            password: Math.random().toString(36).slice(-8), // Generate a random password
            legalAccepted: true,
          });

          // Then complete the sign-up
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
            // If sign up didn't create a session, try to sign in
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
  }, [handlePostSignIn]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: "",
          headerLeft: isFromInfo
            ? () => (
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={styles.backButton}
                >
                  <IconSymbol
                    name={Platform.OS === "ios" ? "chevron.left" : "arrow-back"}
                    size={24}
                    color={colors.text}
                  />
                </TouchableOpacity>
              )
            : undefined,
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerTintColor: colors.text,
        }}
      />
      <View style={[styles.content, { backgroundColor: colors.background }]}>
        <View style={styles.titleContainer}>
          <Image
            source={require("@/assets/images/MeetCal-no-bg.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.title, { color: colors.text }]}>
            Welcome to MeetCal
          </Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Please Sign In to Continue
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            styles.googleButton,
            {
              backgroundColor:
                currentTheme === "dark" ? "#FFFFFF" : colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={onGooglePress}
        >
          <View style={styles.googleIconContainer}>
            <Image
              source={require("@/assets/images/ios_light_sq_na.png")}
              style={styles.googleIcon}
            />
          </View>
          <Text
            style={[
              styles.buttonText,
              styles.googleButtonText,
              {
                color: currentTheme === "dark" ? "#000000" : colors.text,
              },
            ]}
          >
            Continue with Google
          </Text>
        </TouchableOpacity>

        {Platform.OS === "ios" && (
          <TouchableOpacity
            style={[
              styles.button,
              styles.appleButton,
              {
                backgroundColor:
                  currentTheme === "dark" ? "#FFFFFF" : "#000000",
              },
            ]}
            onPress={onApplePress}
          >
            <View style={styles.iconContainer}>
              <IconSymbol
                name="apple.logo"
                size={22}
                color={currentTheme === "dark" ? "#000000" : "#FFFFFF"}
              />
            </View>
            <Text
              style={[
                styles.buttonText,
                styles.appleButtonText,
                {
                  color: currentTheme === "dark" ? "#000000" : "#FFFFFF",
                },
              ]}
            >
              Continue with Apple
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  backButton: {
    padding: 8,
    marginLeft: Platform.OS === "ios" ? -8 : 0,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  googleIconContainer: {
    marginRight: 8,
  },
  googleIcon: {
    width: 18,
    height: 18,
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0.25,
    fontFamily: Platform.OS === "ios" ? "-apple-system" : "sans-serif-medium",
  },
  appleButton: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 50,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  iconContainer: {
    marginRight: 8,
  },
  appleButtonText: {
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0.25,
    fontFamily: Platform.OS === "ios" ? "-apple-system" : "sans-serif-medium",
  },
  titleContainer: {
    marginBottom: 32,
    alignItems: "center",
    width: "100%",
  },
  logo: {
    width: Dimensions.get("window").width * 0.5, // 50% of screen width
    height: Dimensions.get("window").width * 0.5 * 0.5, // Maintain aspect ratio (2:1)
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
  },
});
