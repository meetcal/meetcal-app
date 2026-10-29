import { Button } from "@/components/ui/Button";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { Radius, Spacing } from "@/constants/Layout";
import { useAppColors } from "@/hooks/useAppColors";
import {
  checkMeetSubmissionForm,
  formatDateEntry,
  MAX_MEET_SUBMISSION_FILES,
  MEET_SUBMISSION_PICKER_TYPES,
  meetSubmissionErrorMessage,
  sendMeetSubmission,
  type PickedFile,
} from "@/lib/meet-submission";
import { useAuth, useUser } from "@clerk/expo";
import * as DocumentPicker from "expo-document-picker";
import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

type Status =
  | { kind: "editing" }
  | { kind: "sending"; file: number; total: number }
  | { kind: "sent" };

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The form for sending a meet MeetCal does not cover yet: its name, dates
 * and schedule or start-list files (`lib/meet-submission.ts`). The screen
 * that hosts it has already made sure the user is signed in; the token is
 * asked of Clerk when sending, never taken from the cached sign-in hint.
 */
export function SubmitMeetForm({ onDone, bottomInset }: { onDone: () => void; bottomInset: number }) {
  const colors = useAppColors();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [meetName, setMeetName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  // Blocks a second tap before the re-render disables the button.
  const sendingRef = useRef(false);

  const isSending = status.kind === "sending";

  const addFiles = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: MEET_SUBMISSION_PICKER_TYPES,
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const picked = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? null,
        size: typeof asset.size === "number" ? asset.size : null,
      }));
      const known = new Set(files.map((file) => file.uri));
      const next = [...files, ...picked.filter((file) => !known.has(file.uri))];
      if (next.length > MAX_MEET_SUBMISSION_FILES) setError(`Add at most ${MAX_MEET_SUBMISSION_FILES} files.`);
      setFiles(next.slice(0, MAX_MEET_SUBMISSION_FILES));
    } catch (pickError) {
      console.warn("Failed to pick meet files:", pickError);
      setError("Couldn't open your files. Try again.");
    }
  };

  const removeFile = (uri: string) => {
    setFiles((current) => current.filter((file) => file.uri !== uri));
  };

  const send = async () => {
    if (sendingRef.current) return;
    const checked = checkMeetSubmissionForm({ meetName, startDate, endDate, files });
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    sendingRef.current = true;
    setError(null);
    setStatus({ kind: "sending", file: 0, total: checked.value.files.length });
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in again to send this meet.");
        setStatus({ kind: "editing" });
        return;
      }
      await sendMeetSubmission(
        token,
        checked.value,
        user?.primaryEmailAddress?.emailAddress ?? null,
        (file, total) => setStatus({ kind: "sending", file, total }),
      );
      setStatus({ kind: "sent" });
    } catch (sendError) {
      console.warn("Failed to send meet submission:", sendError);
      setError(meetSubmissionErrorMessage(sendError));
      setStatus({ kind: "editing" });
    } finally {
      sendingRef.current = false;
    }
  };

  const startOver = () => {
    setMeetName("");
    setStartDate("");
    setEndDate("");
    setFiles([]);
    setError(null);
    setStatus({ kind: "editing" });
  };

  if (status.kind === "sent") {
    return (
      <View style={[styles.sent, { paddingBottom: bottomInset }]} testID="submit-meet-sent">
        <IconSymbol name="checkmark.circle.fill" size={56} color={colors.success} />
        <ThemedText style={[styles.sentTitle, { color: colors.text }]}>Thanks!</ThemedText>
        <ThemedText style={[styles.sentBody, { color: colors.secondaryText }]}>
          We got the files and will add the meet soon.
        </ThemedText>
        <View style={styles.sentButtons}>
          <Button
            testID="submit-meet-done" title="Done" onPress={onDone}
            fullWidth
          />
          <Button
            testID="submit-meet-send-another" title="Send Another Meet" variant="secondary"
            onPress={startOver} fullWidth
          />
        </View>
      </View>
    );
  }

  const inputStyle = [
    styles.input,
    { color: colors.text, backgroundColor: colors.card, borderColor: colors.border },
  ];
  const sendTitle = isSending
    ? status.file === 0 || status.file > status.total
      ? "Sending…"
      : `Uploading ${status.file} of ${status.total}…`
    : "Send Meet";

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      keyboardShouldPersistTaps="handled"
      testID="submit-meet-form"
    >
      <ThemedText style={[styles.intro, { color: colors.secondaryText }]}>
        Don&apos;t see your meet? Send us its schedule or start list and we&apos;ll add it.
      </ThemedText>

      <ThemedText style={[styles.label, { color: colors.text }]}>Meet name</ThemedText>
      <TextInput
        testID="submit-meet-name"
        style={inputStyle}
        value={meetName}
        onChangeText={setMeetName}
        placeholder="2027 Example Open"
        placeholderTextColor={colors.placeholder}
        editable={!isSending}
        autoCapitalize="words"
        returnKeyType="next"
      />

      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <ThemedText style={[styles.label, { color: colors.text }]}>Start date</ThemedText>
          <TextInput
            testID="submit-meet-start-date"
            style={inputStyle}
            value={startDate}
            onChangeText={(text) => setStartDate(formatDateEntry(text))}
            placeholder="MM/DD/YYYY"
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
            maxLength={10}
            editable={!isSending}
          />
        </View>
        <View style={styles.dateField}>
          <ThemedText style={[styles.label, { color: colors.text }]}>End date (optional)</ThemedText>
          <TextInput
            testID="submit-meet-end-date"
            style={inputStyle}
            value={endDate}
            onChangeText={(text) => setEndDate(formatDateEntry(text))}
            placeholder="MM/DD/YYYY"
            placeholderTextColor={colors.placeholder}
            keyboardType="number-pad"
            maxLength={10}
            editable={!isSending}
          />
        </View>
      </View>

      <ThemedText style={[styles.label, { color: colors.text }]}>Files</ThemedText>
      <ThemedText style={[styles.hint, { color: colors.secondaryText }]}>
        {`PDFs, photos, spreadsheets or Word documents. Up to ${MAX_MEET_SUBMISSION_FILES} files, 20 MB each.`}
      </ThemedText>
      {files.length > 0 && (
        <View style={[styles.fileList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {files.map((file, index) => (
            <View
              key={file.uri}
              style={[
                styles.fileRow,
                index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={styles.fileText}>
                <ThemedText style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>
                  {file.name}
                </ThemedText>
                {file.size !== null && (
                  <ThemedText style={[styles.fileSize, { color: colors.secondaryText }]}>
                    {formatSize(file.size)}
                  </ThemedText>
                )}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                hitSlop={10}
                disabled={isSending}
                onPress={() => removeFile(file.uri)}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <IconSymbol name="xmark.circle.fill" size={20} color={colors.secondaryText} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Button
        testID="submit-meet-add-files"
        title="Add Files"
        variant="secondary"
        icon={<IconSymbol name="plus" size={16} color={colors.link} />}
        onPress={addFiles}
        disabled={isSending || files.length >= MAX_MEET_SUBMISSION_FILES}
        fullWidth
      />

      {error !== null && (
        <ThemedText testID="submit-meet-error" style={[styles.error, { color: colors.danger }]}>
          {error}
        </ThemedText>
      )}

      <Button
        testID="submit-meet-send"
        title={sendTitle}
        onPress={send}
        loading={isSending}
        haptic
        fullWidth
        style={styles.sendButton}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  intro: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: Spacing.sm,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 16,
  },
  dateRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  dateField: {
    flex: 1,
    gap: Spacing.sm,
  },
  fileList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    marginBottom: Spacing.xs,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  fileText: {
    flex: 1,
  },
  fileName: {
    fontSize: 15,
  },
  fileSize: {
    fontSize: 12,
  },
  error: {
    fontSize: 14,
    marginTop: Spacing.sm,
  },
  sendButton: {
    marginTop: Spacing.lg,
  },
  sent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  sentTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  sentBody: {
    fontSize: 15,
    textAlign: "center",
  },
  sentButtons: {
    alignSelf: "stretch",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
});
