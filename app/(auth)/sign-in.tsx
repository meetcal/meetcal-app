import { IconSymbol } from "@/components/ui/IconSymbol";
import { useTheme } from "@/contexts/ThemeContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useSignInHandlers } from "@/utils/handleSignIn";
import { useSSO } from "@clerk/clerk-expo";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect } from "react";
import {
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
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
  const { currentTheme } = useTheme();
  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const colors = useAppColors();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const isFromInfo = from === "info";
  const { onGooglePress, onApplePress } = useSignInHandlers();
  useWarmUpBrowser();
  const { width: windowWidth } = useWindowDimensions();

  const getOAuthErrorMessage = (error: unknown) => {
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message;
      }
    }

    return "Please try again.";
  };

  const handleGooglePress = async () => {
    try {
      await onGooglePress(startSSOFlow);
    } catch (error) {
      Alert.alert("Google sign in failed", getOAuthErrorMessage(error));
    }
  };

  const handleApplePress = async () => {
    try {
      await onApplePress(startSSOFlow);
    } catch (error) {
      Alert.alert("Apple sign in failed", getOAuthErrorMessage(error));
    }
  };

  const authParams = {
    ...(from ? { from } : {}),
    ...(feature ? { feature } : {}),
  };

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
            style={[styles.logo, { width: windowWidth * 0.5, height: windowWidth * 0.25 }]}
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
          onPress={handleGooglePress}
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
            onPress={handleApplePress}
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

        <View style={styles.emailActionsContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.emailButton,
              {
                backgroundColor: colors.link,
              },
            ]}
            onPress={() =>
              router.push({
                pathname: "/(auth)/email-sign-in",
                params: authParams,
              } as any)
            }
          >
            <Text
              style={[
                styles.buttonText,
                styles.emailButtonText,
                { color: colors.card },
              ]}
            >
              Continue with Email
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.createAccountButton}
            onPress={() =>
              router.push({
                pathname: "/(auth)/create-account",
                params: authParams,
              } as any)
            }
          >
            <Text style={[styles.createAccountText, { color: colors.link }]}>
              Create an account
            </Text>
          </TouchableOpacity>
        </View>
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
    paddingLeft: 12,
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
  emailActionsContainer: {
    marginTop: 16,
    gap: 12,
  },
  emailButton: {
    height: 50,
    justifyContent: "center",
  },
  emailButtonText: {
    fontWeight: "600",
  },
  createAccountButton: {
    alignItems: "center",
    paddingVertical: 4,
  },
  createAccountText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
