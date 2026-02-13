import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

interface DropdownProps {
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  placeholder?: string;
}

export const Dropdown = ({
  value,
  options = [],
  onSelect,
  placeholder = "Select an option",
}: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const colors = useAppColors();

  return (
    <React.Fragment>
      <Pressable
        style={({ pressed }) => [
          styles.input,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
          pressed && { opacity: 0.7 },
        ]}
        onPress={() => setIsOpen(true)}
      >
        <ThemedText
          style={[
            styles.text,
            { color: value ? colors.text : colors.secondaryText },
          ]}
        >
          {value || placeholder}
        </ThemedText>
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={[
            styles.modalOverlay,
            {
              backgroundColor: colors.modalBackground,
            },
          ]}
          onPress={() => setIsOpen(false)}
        >
          <View
            style={styles.modalContentContainer}
            onStartShouldSetResponder={() => true}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <View
              style={[styles.modalContent, { backgroundColor: colors.card }]}
            >
              {options.length === 0 ? (
                <View style={styles.option}>
                  <ThemedText
                    style={[styles.optionText, { color: colors.secondaryText }]}
                  >
                    No options available
                  </ThemedText>
                </View>
              ) : (
                options.map((option) => (
                  <Pressable
                    key={option}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        borderBottomColor: colors.border,
                        backgroundColor:
                          value === option ? colors.pressed : "transparent",
                      },
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={(e) => {
                      e.stopPropagation();
                      onSelect(option);
                      setIsOpen(false);
                    }}
                  >
                    <ThemedText
                      style={[styles.optionText, { color: colors.text }]}
                    >
                      {option}
                    </ThemedText>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </Pressable>
      </Modal>
    </React.Fragment>
  );
};

const styles = StyleSheet.create({
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  text: {
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContentContainer: {
    width: "80%",
    maxHeight: "80%",
  },
  modalContent: {
    borderRadius: 12,
    overflow: "hidden",
    maxHeight: 300,
  },
  option: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: {
    fontSize: 17,
  },
});
