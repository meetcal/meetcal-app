import { Linking } from "react-native";

import { showToast } from "@/lib/toast";

export const WEB_LINK_FAILED_MESSAGE = "Couldn't open that link. Please try again.";

export async function openWebLink(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn("Could not open the link", url, error);
    showToast({ type: "error", message: WEB_LINK_FAILED_MESSAGE });
  }
}
