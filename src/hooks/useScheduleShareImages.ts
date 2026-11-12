import { showToast } from "@/components/ui/Toast";
import { lightImpact } from "@/lib/haptics";
import { captureViewAsPng } from "@/lib/share-image";
import type React from "react";
import { useRef, useState } from "react";
import type { View } from "react-native";

const SHARE_IMAGE_WIDTH = 850;
const CAPTURE_SETTLE_MS = 100;
const IMAGE_FAILED_MESSAGE = "Failed to generate schedule image. Please try again.";

type CaptureViewRef = React.RefObject<React.ComponentRef<typeof View> | null>;

export type ScheduleShareImagePreview = {
  visible: boolean;
  whiteImageUri: string | null;
  transparentImageUri: string | null;
  selectedIndex: number;
  onChangeIndex: (index: number) => void;
  onClose: () => void;
};

export type ScheduleShareImages = {
  captureViewsMounted: boolean;
  whiteViewRef: CaptureViewRef;
  transparentViewRef: CaptureViewRef;
  captureImages: () => Promise<void>;
  preview: ScheduleShareImagePreview;
};

export function useScheduleShareImages(): ScheduleShareImages {
  const [whiteImageUri, setWhiteImageUri] = useState<string | null>(null);
  const [transparentImageUri, setTransparentImageUri] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [captureViewsMounted, setCaptureViewsMounted] = useState(false);
  const whiteViewRef = useRef<React.ComponentRef<typeof View>>(null);
  const transparentViewRef = useRef<React.ComponentRef<typeof View>>(null);

  const captureImages = async () => {
    try {
      setCaptureViewsMounted(true);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      if (!whiteViewRef.current || !transparentViewRef.current) {
        setCaptureViewsMounted(false);
        showToast({ type: "error", message: IMAGE_FAILED_MESSAGE });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, CAPTURE_SETTLE_MS));

      const [whiteUri, transparentUri] = await Promise.all([
        captureViewAsPng(whiteViewRef.current, { width: SHARE_IMAGE_WIDTH }),
        captureViewAsPng(transparentViewRef.current, { width: SHARE_IMAGE_WIDTH }),
      ]);
      setWhiteImageUri(whiteUri);
      setTransparentImageUri(transparentUri);
      setSelectedIndex(0);
      lightImpact();
      setPreviewVisible(true);
    } catch (error) {
      setCaptureViewsMounted(false);
      console.error("Error capturing image:", error);
      showToast({ type: "error", message: IMAGE_FAILED_MESSAGE });
    }
  };

  const closePreview = () => {
    setPreviewVisible(false);
    setWhiteImageUri(null);
    setTransparentImageUri(null);
    setCaptureViewsMounted(false);
  };

  return {
    captureViewsMounted,
    whiteViewRef,
    transparentViewRef,
    captureImages,
    preview: {
      visible: previewVisible,
      whiteImageUri,
      transparentImageUri,
      selectedIndex,
      onChangeIndex: setSelectedIndex,
      onClose: closePreview,
    },
  };
}
