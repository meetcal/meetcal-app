import { useAppColors } from "@/hooks/useAppColors";
import { TextInput as RNTextInput, StyleSheet } from "react-native";

interface TextInputProps extends React.ComponentProps<typeof RNTextInput> {
  style?: any;
}

export const TextInput = ({ style, ...props }: TextInputProps) => {
  const colors = useAppColors();

  return (
    <RNTextInput
      style={[
        styles.input,
        style,
        {
          backgroundColor: colors.background,
          color: colors.primaryText,
        },
      ]}
      placeholderTextColor={colors.secondaryText}
      {...props}
    />
  );
};

const styles = StyleSheet.create({
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 15,
  },
});
