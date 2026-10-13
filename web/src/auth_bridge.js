const CLERK_UI_VERSION = "1.25.5";
const CLERK_JS_VERSION = "6.25.5";
const REVENUECAT_JS_VERSION = "1.47.3";
// The RevenueCat entitlement that unlocks the data pages: the app's
// `SUBSCRIPTION_ENTITLEMENT_ID` (src/lib/premium-intent.ts). Any other
// entitlement in the project must not unlock them.
const SUBSCRIPTION_ENTITLEMENT_ID = "Subscriptions";
// Longest one RevenueCat check may hold the queue, so a stuck call cannot
// block every later check for the rest of the session.
const REVENUECAT_OPERATION_TIMEOUT_MS = 20_000;
let revenueCatOperationQueue = Promise.resolve();
// One load per script URL. A failed load is forgotten and its tag removed,
// so the next call inserts a fresh tag instead of waiting on a dead one.
const scriptLoads = new Map();

function loadScript(src, label, attributes = {}) {
  const pending = scriptLoads.get(src);
  if (pending) return pending;

  const load = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    Object.entries(attributes).forEach(([name, value]) => script.setAttribute(name, value));
    script.src = src;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      scriptLoads.delete(src);
      reject(new Error(`The ${label} service could not be loaded. Check your connection and try again.`));
    }, { once: true });
    document.head.appendChild(script);
  });
  scriptLoads.set(src, load);
  return load;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function clerkUserId() {
  return window.Clerk?.isSignedIn && window.Clerk.user ? window.Clerk.user.id : null;
}

export async function initialize_clerk(publishableKey, onAuthChanged) {
  if (!publishableKey) throw new Error("CLERK_PUBLISHABLE_KEY is not configured");

  const uiUrl = `https://cdn.jsdelivr.net/npm/@clerk/ui@${CLERK_UI_VERSION}/dist/ui.browser.js`;
  const clerkUrl = `https://cdn.jsdelivr.net/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`;

  await loadScript(uiUrl, "sign-in");
  await loadScript(clerkUrl, "sign-in", { "data-clerk-publishable-key": publishableKey });
  await window.Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: {
      variables: {
        colorPrimary: "#007aff",
        colorText: "#10223b",
        borderRadius: "0.85rem",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      },
      options: { privacyPageUrl: "/privacy", termsPageUrl: "/terms" },
    },
  });

  window.Clerk.addListener(() => onAuthChanged(clerkUserId()));
  onAuthChanged(clerkUserId());
}

export function mount_clerk_user_button(element) {
  if (!window.Clerk?.isSignedIn) return;
  element.replaceChildren();
  window.Clerk.mountUserButton(element, {
    showName: !window.matchMedia("(max-width: 880px)").matches,
    userProfileMode: "modal",
    appearance: {
      elements: {
        userButtonBox: { flexDirection: "row-reverse" },
        userButtonOuterIdentifier: { fontWeight: "700", color: "#10223b" },
      },
    },
    customMenuItems: [{
      label: "Subscription in the app",
      onClick: () => window.location.assign("/subscription"),
      mountIcon: icon => {
        icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M7 11h2m3 0h2"/><rect x="3" y="5" width="18" height="14" rx="3"/></svg>`;
      },
      unmountIcon: icon => { if (icon) icon.replaceChildren(); },
    }],
  });
}

export function unmount_clerk_user_button(element) {
  if (window.Clerk) window.Clerk.unmountUserButton(element);
}

export function mount_clerk_sign_in(element) {
  element.replaceChildren();
  // A mounted sign-in returns to "/" by default; return to the gated page
  // (with its query, such as `/results?athlete=…`) instead.
  const here = window.location.href;
  window.Clerk.mountSignIn(element, {
    fallbackRedirectUrl: here,
    signUpFallbackRedirectUrl: here,
    appearance: { elements: { rootBox: { margin: "0 auto" } } },
  });
}

export function unmount_clerk_sign_in(element) {
  if (window.Clerk) window.Clerk.unmountSignIn(element);
}

export function open_clerk_sign_in() {
  if (window.Clerk) window.Clerk.openSignIn();
}

async function revenueCatForUser(apiKey, appUserId) {
  if (!apiKey) throw new Error("REVENUECAT_PUBLIC_API_KEY is not configured");
  await loadScript(`https://unpkg.com/@revenuecat/purchases-js@${REVENUECAT_JS_VERSION}/dist/Purchases.umd.js`, "subscription");

  const Purchases = window.Purchases?.Purchases;
  if (!Purchases) throw new Error("RevenueCat Web SDK did not initialize");

  if (!Purchases.isConfigured()) {
    return Purchases.configure({ apiKey, appUserId });
  }

  const purchases = Purchases.getSharedInstance();
  if (purchases.getAppUserId() !== appUserId) await purchases.changeUser(appUserId);
  return purchases;
}

function withRevenueCatUser(apiKey, appUserId, operation) {
  const run = async () => {
    if (clerkUserId() !== appUserId) throw new Error("Your signed-in account changed. Please try again.");
    const purchases = await revenueCatForUser(apiKey, appUserId);
    if (clerkUserId() !== appUserId) throw new Error("Your signed-in account changed. Please try again.");
    const result = await operation(purchases);
    // A timed-out call for another user may have switched the shared
    // instance meanwhile; never answer with someone else's entitlements.
    if (purchases.getAppUserId() !== appUserId || clerkUserId() !== appUserId) {
      throw new Error("Your signed-in account changed. Please try again.");
    }
    return result;
  };

  const timedRun = () => withTimeout(
    run(),
    REVENUECAT_OPERATION_TIMEOUT_MS,
    "Checking your subscription took too long. Please try again.",
  );
  const result = revenueCatOperationQueue.then(timedRun, timedRun);
  revenueCatOperationQueue = result.catch(() => undefined);
  return result;
}

function hasActiveEntitlement(customerInfo) {
  return customerInfo?.entitlements?.active?.[SUBSCRIPTION_ENTITLEMENT_ID] != null;
}

export async function check_revenuecat_entitlement(apiKey, appUserId) {
  return withRevenueCatUser(apiKey, appUserId, async purchases => {
    const customerInfo = await purchases.getCustomerInfo();
    return hasActiveEntitlement(customerInfo);
  });
}
