import { EditableField } from "@/app/schedule-toolbar/profile";
import { useAppColors } from "@/hooks/useAppColors";
import { useUser } from "@clerk/clerk-expo";
import React from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "../ui/IconSymbol";
import { ThemedText } from "../ui/ThemedText";

interface EditProfileModalProps {
  isEditing: boolean;
  setIsEditing: (isEditing: boolean) => void;
  editingField: EditableField | null;
  setEditingField: (editingField: string | null) => void;
  editValue: string;
  setEditValue: (editValue: string) => void;
  setIsLoading: (isLoading: boolean) => void;
  isLoading: boolean;
}

const EditProfileModal = ({
  isEditing,
  setIsEditing,
  editingField,
  setEditingField,
  editValue,
  setEditValue,
  setIsLoading,
  isLoading,
}: EditProfileModalProps) => {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const handleSave = async () => {
    if (!editingField || !user) return;

    setIsLoading(true);
    try {
      switch (editingField) {
        case "firstName":
          await user.update({
            firstName: editValue,
          });
          break;
        case "lastName":
          await user.update({
            lastName: editValue,
          });
          break;
        case "email":
          // Ensure email is different before creating
          if (editValue === user.primaryEmailAddress?.emailAddress) {
            setIsEditing(false);
            setEditingField(null);
            return; // No change needed
          }
          const emailAddress = await user.createEmailAddress({
            email: editValue,
          });
          await emailAddress.prepareVerification({
            strategy: "email_code",
          });

          Alert.alert(
            "Verification Required",
            "Please check your email to verify your new email address.",
          );
          break;
      }
      setIsEditing(false);
      setEditingField(null);
    } catch (err) {
      console.error("Error updating profile:", err);
      Alert.alert("Error", "Failed to update profile. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const formatTitle = (field: string) => {
    return field
      .replace(/([A-Z])/g, " $1")
      .trim()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <Modal
      visible={isEditing}
      transparent
      animationType="fade"
      onRequestClose={() => setIsEditing(false)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Pressable
          style={[
            styles.modalOverlay,
            { backgroundColor: colors.modalBackground },
          ]}
          onPress={() => {
            Keyboard.dismiss();
            setIsEditing(false);
          }}
        >
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 20,
                maxHeight: "80%",
              },
            ]}
          >
            <View
              style={[styles.modalHeader, { borderBottomColor: colors.border }]}
            >
              <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                Edit {editingField ? formatTitle(editingField) : ""}
              </ThemedText>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  Keyboard.dismiss();
                  setIsEditing(false);
                }}
              >
                <IconSymbol
                  name={Platform.OS === "ios" ? "xmark" : "close"}
                  size={20}
                  color={colors.secondaryText}
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              <>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      backgroundColor: colors.pressed,
                      borderColor: colors.border,
                    },
                  ]}
                  value={editValue}
                  onChangeText={setEditValue}
                  placeholder={`Enter ${formatTitle(editingField || "")}`}
                  placeholderTextColor={colors.secondaryText}
                  autoCapitalize={editingField === "email" ? "none" : "words"}
                  keyboardType={
                    editingField === "email" ? "email-address" : "default"
                  }
                  autoFocus
                />

                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    isLoading && styles.saveButtonDisabled,
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
                    handleSave();
                  }}
                  disabled={isLoading}
                >
                  <ThemedText style={styles.saveButtonText}>
                    Save Changes
                  </ThemedText>
                </TouchableOpacity>
              </>
            </ScrollView>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default EditProfileModal;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  modalHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    padding: 4,
  },
  modalBody: {
    padding: 16,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 17,
    marginBottom: 16,
  },
  saveButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});
