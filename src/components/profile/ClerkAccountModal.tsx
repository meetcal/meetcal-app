import { useAuth } from "@clerk/expo";
import { UserProfileView } from "@clerk/expo/native";
import React, { useEffect, useRef } from "react";
import { Modal, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppColors } from "@/hooks/useAppColors";

interface ClerkAccountModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * The user signed out from inside Clerk's view. Clerk syncs the sign-out
   * to the JS SDK; the app still has to clear its own auth cache and leave
   * the signed-in screen, as the profile's Sign Out button does.
   */
  onSignedOut: () => void;
}

/**
 * Clerk's native account screen (email addresses, verification, password,
 * connected accounts, sign-out), shown in a sheet.
 *
 * Email changes go through here rather than an in-app form. The old form
 * added the new address and sent a code, but had no step to enter it, so the
 * address was left unverified on the account and never became primary.
 */
export function ClerkAccountModal({ visible, onClose, onSignedOut }: ClerkAccountModalProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const wasSignedIn = useRef(isSignedIn);

  useEffect(() => {
    const signedOutHere = visible && wasSignedIn.current === true && isSignedIn === false;
    wasSignedIn.current = isSignedIn;
    if (signedOutHere) {
      onClose();
      onSignedOut();
    }
  }, [visible, isSignedIn, onClose, onSignedOut]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingBottom: insets.bottom },
        ]}
      >
        <UserProfileView isDismissible onDismiss={onClose} style={styles.container} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
