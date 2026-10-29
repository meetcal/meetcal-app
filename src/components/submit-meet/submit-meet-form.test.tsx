/**
 * Sending a meet MeetCal does not cover: the meet picker's row opens the
 * form, and the form checks what it can, uploads, and says how it went.
 */
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import * as DocumentPicker from "expo-document-picker";
import { MeetSelectionModal } from "@/components/schedule/MeetSelectionModal";
import { SubmitMeetForm } from "@/components/submit-meet/SubmitMeetForm";
import { MeetCalApiError } from "@/lib/api/meetcal-api";
import { sendMeetSubmission } from "@/lib/meet-submission";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/MaterialSurface", () => ({ MaterialSurface: () => null }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: (value: number) => value,
}));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
const mockGetToken = jest.fn();
jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "lifter@example.com" } } }),
}));
jest.mock("@/lib/meet-submission", () => ({
  ...jest.requireActual("@/lib/meet-submission"),
  sendMeetSubmission: jest.fn(),
}));

const pickMock = DocumentPicker.getDocumentAsync as jest.Mock;
const sendMock = sendMeetSubmission as jest.Mock;

beforeEach(() => {
  pickMock.mockReset();
  sendMock.mockReset();
  mockGetToken.mockReset().mockResolvedValue("clerk-token");
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const input = (tree: ReactTestRenderer, testID: string): ReactTestInstance =>
  tree.root.find((node) => node.props.testID === testID && typeof node.props.onChangeText === "function");
const pressable = (tree: ReactTestRenderer, testID: string): ReactTestInstance =>
  tree.root.find((node) => node.props.testID === testID && typeof node.props.onPress === "function");
const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => node.props.children as string)
    .join("\n");

async function render(onDone = jest.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<SubmitMeetForm onDone={onDone} bottomInset={0} />);
  });
  return tree;
}

async function fill(tree: ReactTestRenderer, fields: { name?: string; start?: string; end?: string }) {
  await act(async () => {
    if (fields.name !== undefined) input(tree, "submit-meet-name").props.onChangeText(fields.name);
    if (fields.start !== undefined) input(tree, "submit-meet-start-date").props.onChangeText(fields.start);
    if (fields.end !== undefined) input(tree, "submit-meet-end-date").props.onChangeText(fields.end);
  });
}

async function addFile(tree: ReactTestRenderer, name = "schedule.pdf") {
  pickMock.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: `file:///cache/${name}`, name, mimeType: "application/pdf", size: 2048 }],
  });
  await act(async () => {
    await pressable(tree, "submit-meet-add-files").props.onPress();
  });
}

async function press(tree: ReactTestRenderer, testID: string) {
  await act(async () => {
    await pressable(tree, testID).props.onPress();
  });
}

describe("the meet picker", () => {
  it("offers the form only when the screen hands it a way there", async () => {
    const onSubmitMeet = jest.fn();
    const props = {
      visible: true,
      onClose: jest.fn(),
      meets: [],
      selectedMeet: null,
      onSelectMeet: jest.fn(),
      onRefresh: jest.fn(),
      isRefreshing: false,
    };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<MeetSelectionModal {...props} />);
    });
    expect(tree.root.findAll((node) => node.props.testID === "meet-selection-submit-meet")).toHaveLength(0);
    await act(async () => {
      tree.update(<MeetSelectionModal {...props} onSubmitMeet={onSubmitMeet} />);
    });
    await press(tree, "meet-selection-submit-meet");
    expect(onSubmitMeet).toHaveBeenCalledTimes(1);
  });
});

describe("SubmitMeetForm", () => {
  it("formats the dates as typed and says what to fix before sending anything", async () => {
    const tree = await render();
    await fill(tree, { name: "Example Open", start: "03062027" });
    expect(input(tree, "submit-meet-start-date").props.value).toBe("03/06/2027");
    await press(tree, "submit-meet-send");
    expect(text(tree)).toContain("Add at least one file.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends the checked meet with the user's email, then thanks them", async () => {
    const onDone = jest.fn();
    const tree = await render(onDone);
    await fill(tree, { name: " Example Open ", start: "03062027", end: "03072027" });
    await addFile(tree, "schedule.pdf");
    await addFile(tree, "start-list.xlsx");
    expect(text(tree)).toContain("start-list.xlsx");
    sendMock.mockResolvedValue(undefined);
    await press(tree, "submit-meet-send");
    expect(sendMock).toHaveBeenCalledWith(
      "clerk-token",
      {
        meetName: "Example Open",
        startDate: "2027-03-06",
        endDate: "2027-03-07",
        files: [
          expect.objectContaining({ name: "schedule.pdf", uri: "file:///cache/schedule.pdf" }),
          expect.objectContaining({ name: "start-list.xlsx" }),
        ],
      },
      "lifter@example.com",
      expect.any(Function),
    );
    expect(text(tree)).toContain("Thanks!");
    await press(tree, "submit-meet-done");
    expect(onDone).toHaveBeenCalled();
  });

  it("keeps the form filled and shows why when sending fails", async () => {
    const tree = await render();
    await fill(tree, { name: "Example Open", start: "03062027" });
    await addFile(tree);
    sendMock.mockRejectedValue(new MeetCalApiError("failed", 429, JSON.stringify({ status: 429, error: "limit" })));
    await press(tree, "submit-meet-send");
    expect(text(tree)).toContain("You can send 5 meets a day. Try again tomorrow.");
    expect(input(tree, "submit-meet-name").props.value).toBe("Example Open");
    expect(text(tree)).toContain("schedule.pdf");
  });

  it("asks the user to sign in again when Clerk has no token, without sending", async () => {
    mockGetToken.mockResolvedValue(null);
    const tree = await render();
    await fill(tree, { name: "Example Open", start: "03062027" });
    await addFile(tree);
    await press(tree, "submit-meet-send");
    expect(text(tree)).toContain("Sign in again to send this meet.");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
