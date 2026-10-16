import { getRoutes } from "expo-router/build/getRoutes";
import { getLinkingConfig } from "expo-router/build/getLinkingConfig";
import { createSeededRootState } from "expo-router/build/global-state/createSeededNavigationState";
import { inMemoryContext } from "expo-router/build/testing-library/context-stubs";

import { ROOT_STACK_SETTINGS } from "@/lib/root-navigation";

type Settings = Record<string, unknown> | undefined;
type State = { routes: { name: string; state?: State }[] };

const Screen = () => null;

/** The app's route tree shape (enough of it), with the root layout's settings. */
function appContext(rootSettings: Settings) {
  return inMemoryContext({
    _layout: rootSettings ? { default: Screen, unstable_settings: rootSettings } : Screen,
    "(tabs)/_layout": Screen,
    "(tabs)/(index)/_layout": Screen,
    "(tabs)/(index)/index": Screen,
    "(tabs)/(saved)/_layout": Screen,
    "(tabs)/(saved)/index": Screen,
    "(auth)/_layout": Screen,
    "(auth)/sign-in": Screen,
    "shared-screens/schedule-details": Screen,
    "comp-data/rankings": Screen,
    "comp-data/new-qualifying-totals": Screen,
  });
}

/** The root stack's route names when `url` cold-starts the app. */
function coldStartRoot(rootSettings: Settings, url: string): string[] {
  const context = appContext(rootSettings);
  const routes = getRoutes(context, { platform: "ios" } as never)!;
  const linking = getLinkingConfig(routes, context, {} as never);
  const parsed = linking.getStateFromPath!(url, linking.config);
  const state = createSeededRootState(parsed as never, routes) as unknown as State;
  // The router's own root (`__root`) holds the root layout's stack.
  const rootStack = state.routes[0].state ?? state;
  return rootStack.routes.map((route) => route.name);
}

describe("cold-start deep links (#357)", () => {
  it.each([
    "/shared-screens/schedule-details?meet=X&sessionNumber=3&platform=Red",
    "/comp-data/rankings?meet=Y",
    "/comp-data/new-qualifying-totals?event=Nationals",
  ])("open %s on top of the tabs", (url) => {
    const names = coldStartRoot(ROOT_STACK_SETTINGS, url);
    expect(names[0]).toBe("(tabs)");
    expect(names).toHaveLength(2);
  });

  it("without the anchor, the linked screen would be alone (the bug)", () => {
    expect(coldStartRoot(undefined, "/comp-data/rankings?meet=Y")).toEqual(["comp-data/rankings"]);
  });
});
