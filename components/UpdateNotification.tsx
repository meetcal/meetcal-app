import { useAppColors } from "@/hooks/useAppColors";
import { useOTAUpdates } from "@/hooks/useOTAUpdates";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export function UpdateNotification() {
  const {
    isUpdateAvailable,
    isDownloading,
    error,
    downloadAndRestart,
    dismissUpdate,
  } = useOTAUpdates();
  const colors = useAppColors();

  const visible = isUpdateAvailable || !!error;

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={dismissUpdate}
      statusBarTranslucent
      {...(Platform.OS === "ios" && { presentationStyle: "overFullScreen" })}
    >
      <Pressable style={styles.backdrop} onPress={dismissUpdate}>
        <Pressable
          style={[styles.modalCard, { backgroundColor: colors.card }]}
          onPress={(e) => e.stopPropagation()}
        >
          {error ? (
            <View style={styles.content}>
              <Text style={[styles.title, { color: colors.danger }]}>
                Update Error
              </Text>
              <Text style={[styles.message, { color: colors.text }]}>
                {error}
              </Text>
              <TouchableOpacity
                style={[styles.button, styles.dismissButton]}
                onPress={dismissUpdate}
              >
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.content}>
              <Text style={[styles.title, { color: colors.success }]}>
                Update Available
              </Text>
              <Text style={[styles.message, { color: colors.text }]}>
                A new version of the app is available. Update now for the latest
                features and improvements.
              </Text>

              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={[styles.button, styles.laterButton]}
                  onPress={dismissUpdate}
                  disabled={isDownloading}
                >
                  <Text
                    style={[styles.laterButtonText, { color: colors.link }]}
                  >
                    Later
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.updateButton,
                    { backgroundColor: colors.link },
                    isDownloading && styles.disabledButton,
                  ]}
                  onPress={downloadAndRestart}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator color="white" size="small" />
                      <Text style={styles.updateButtonText}>Updating...</Text>
                    </View>
                  ) : (
                    <Text style={styles.updateButtonText}>Update Now</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 16,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  laterButton: {
    backgroundColor: "transparent",
  },
  laterButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
  updateButton: {
    backgroundColor: "#007aff",
  },
  updateButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  dismissButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#ff3b30",
  },
  dismissButtonText: {
    color: "#ff3b30",
    fontSize: 16,
    fontWeight: "500",
  },
  disabledButton: {
    opacity: 0.6,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
