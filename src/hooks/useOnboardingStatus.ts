import { checkOnboardingComplete } from "@/components/schedule/OnboardingView";
import { isMaestroE2E } from "@/lib/e2e";
import { useCallback, useEffect, useState } from "react";

export type OnboardingStatus = "checking" | "showing" | "done";

export function useOnboardingStatus(): {
  onboardingStatus: OnboardingStatus;
  completeOnboarding: () => void;
} {
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus>("checking");

  useEffect(() => {
    if (isMaestroE2E()) {
      setOnboardingStatus("done");
      return;
    }

    let aborted = false;

    const checkOnboarding = async () => {
      try {
        const completed = await checkOnboardingComplete();
        if (!aborted) setOnboardingStatus(completed ? "done" : "showing");
      } catch (error) {
        if (!aborted) {
          console.error("Error checking onboarding status:", error);
          setOnboardingStatus("done");
        }
      }
    };

    void checkOnboarding();

    return () => {
      aborted = true;
    };
  }, []);

  const completeOnboarding = useCallback(() => setOnboardingStatus("done"), []);
  return { onboardingStatus, completeOnboarding };
}
