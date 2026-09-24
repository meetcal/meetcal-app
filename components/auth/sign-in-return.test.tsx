/**
 * The real `(auth)` layout with the real sign-in screen inside it. Clerk,
 * SecureStore and the router are stubbed; the Stack renders the sign-in
 * screen directly. When Clerk flips to signed in, the sign-in screen must
 * still be mounted to send the user back to `from` and write the auth cache.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AuthRoutesLayout from "@/app/(auth)/_layout";
import { clearAuthCache } from "@/lib/authCache";
import {
  confirmRevenueCatIdentity,
  forgetRevenueCatIdentity,
  resetPremiumIntentState,
} from "@/lib/premium-intent";

const mockSecureStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

const mockAuth = { isLoaded: true, isSignedIn: false, userId: null as string | null };
jest.mock("@clerk/expo", () => ({
  useAuth: () => mockAuth,
  useUser: () => ({ user: null, isLoaded: true }),
}));
jest.mock("@clerk/expo/native", () => ({ AuthView: () => null }));

jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: () => () => {},
}));

const mockRouter = {
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  push: jest.fn(),
};
let mockParams: { from?: string; feature?: string } = {};
const mockRedirects: unknown[] = [];
jest.mock("expo-router", () => ({
  // A getter: the factory runs during the hoisted imports, before
  // `mockRouter` is initialised.
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  // Resolved lazily: sign-in imports this module, so requiring it while the
  // mock is being built would see a half-initialised `router`.
  Stack: function MockStack() {
    const { default: SignIn } = jest.requireActual<typeof import("@/app/(auth)/sign-in")>(
      "@/app/(auth)/sign-in",
    );
    return <SignIn />;
  },
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirects.push(href);
    return null;
  },
}));

const AUTH_CACHE_KEY = "auth_state_cache";

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function mountLayout(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<AuthRoutesLayout />);
  });
  await flush();
  return renderer;
}

async function signIn(renderer: ReactTestRenderer): Promise<void> {
  mockAuth.isSignedIn = true;
  mockAuth.userId = "user_1";
  await act(async () => {
    renderer.update(<AuthRoutesLayout />);
  });
  await flush();
}

describe("sign-in return path", () => {
  beforeEach(async () => {
    // `lib/authCache` remembers the last signature it wrote; an earlier test's
    // write would make this file's first sign-in a skipped no-op write.
    await clearAuthCache();
    resetPremiumIntentState();
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockSecureStore.clear();
    mockRedirects.length = 0;
    mockParams = {};
    mockAuth.isLoaded = true;
    mockAuth.isSignedIn = false;
    mockAuth.userId = null;
    mockRouter.canGoBack.mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns to `from` and caches the sign-in after Clerk flips to signed in", async () => {
    mockParams = { from: "/schedule-toolbar/profile", feature: "profile" };
    const renderer = await mountLayout();
    expect(mockRedirects).toEqual([]);

    await signIn(renderer);

    expect(mockRedirects).toEqual([]);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith("/schedule-toolbar/profile");
    expect(JSON.parse(mockSecureStore.get(AUTH_CACHE_KEY) ?? "null")).toMatchObject({
      isSignedIn: true,
      userId: "user_1",
    });
  });

  it("does not detour through the paywall on sign-in", async () => {
    mockParams = { from: "/(tabs)/records", feature: "records" };
    const renderer = await mountLayout();

    await signIn(renderer);

    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/records");
    expect(JSON.stringify(mockRouter.replace.mock.calls)).not.toContain("paywall");
  });

  describe("premium intent", () => {
    const paywallPushes = () =>
      mockRouter.push.mock.calls.filter(([href]) =>
        JSON.stringify(href).includes("/shared-screens/paywall"),
      );

    it("opens the paywall for a free user only after RevenueCat confirms the new user", async () => {
      mockParams = { from: "/shared-screens/schedule-details", feature: "attempt-estimator" };
      const renderer = await mountLayout();

      await signIn(renderer);

      expect(mockRouter.replace).toHaveBeenCalledWith("/shared-screens/schedule-details");
      expect(paywallPushes()).toEqual([]);
      // What `app/_layout.tsx` does once `Purchases.logIn` resolves.
      expect(confirmRevenueCatIdentity("user_1", false)).toEqual({
        from: "/shared-screens/schedule-details",
        feature: "attempt-estimator",
      });
    });

    it("pushes the paywall on top of `from` when logIn already resolved as free", async () => {
      confirmRevenueCatIdentity("user_1", false);
      mockParams = { from: "/shared-screens/schedule-details", feature: "qualifying-totals" };
      const renderer = await mountLayout();

      await signIn(renderer);

      expect(mockRouter.replace).toHaveBeenCalledWith("/shared-screens/schedule-details");
      expect(paywallPushes()).toEqual([
        [
          {
            pathname: "/shared-screens/paywall",
            params: { from: "/shared-screens/schedule-details", feature: "qualifying-totals" },
          },
        ],
      ]);
    });

    it("never opens the paywall from the pre-logIn anonymous 'free' entitlement", async () => {
      confirmRevenueCatIdentity("$RCAnonymousID:abc", false);
      mockParams = { from: "/(tabs)/(start-list)", feature: "sort-athletes" };
      const renderer = await mountLayout();

      await signIn(renderer);
      forgetRevenueCatIdentity();

      expect(paywallPushes()).toEqual([]);
      // logIn resolves: a subscriber.
      expect(confirmRevenueCatIdentity("user_1", true)).toBeNull();
    });

    it("does not open the paywall after signing in for a free action", async () => {
      confirmRevenueCatIdentity("user_1", false);
      mockParams = { from: "/schedule-toolbar/profile", feature: "profile" };
      const renderer = await mountLayout();

      await signIn(renderer);

      expect(paywallPushes()).toEqual([]);
    });
  });

  it.each(["https://evil.example/phish", "//evil.example", undefined])(
    "falls back to the default tab for from=%s",
    async (from) => {
      mockParams = { from };
      const renderer = await mountLayout();

      await signIn(renderer);

      expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)/(index)");
    },
  );

  it("still redirects a user who arrives already signed in", async () => {
    mockAuth.isSignedIn = true;
    mockAuth.userId = "user_1";

    await mountLayout();

    expect(mockRedirects).toEqual(["/(tabs)/(index)"]);
  });
});
