import {
  DEFAULT_TOAST_DURATION_MS,
  ERROR_TOAST_DURATION_MS,
  handOffToast,
  registerToastHandler,
  SCREEN_READER_MIN_TOAST_DURATION_MS,
  showToast,
  toastDurationMs,
} from "@/lib/toast";

describe("toast handle", () => {
  it("delivers to the registered host, and stops after it unregisters", () => {
    const handler = jest.fn();
    const unregister = registerToastHandler(handler);

    showToast({ type: "info", message: "hello" });
    expect(handler).toHaveBeenCalledWith({ type: "info", message: "hello" });

    unregister();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    showToast({ type: "info", message: "dropped" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not let a stale host unregister its replacement", () => {
    const first = jest.fn();
    const second = jest.fn();
    const unregisterFirst = registerToastHandler(first);
    const unregisterSecond = registerToastHandler(second);

    unregisterFirst();
    showToast({ type: "success", message: "still here" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    unregisterSecond();
  });
});

describe("toast hosts above modals", () => {
  it("sends each toast to the newest host, and back to the one below once it leaves", () => {
    const root = jest.fn();
    const modal = jest.fn();
    const unregisterRoot = registerToastHandler(root);
    const unregisterModal = registerToastHandler(modal);

    showToast({ type: "error", message: "Couldn't add to calendar" });
    expect(modal).toHaveBeenCalledTimes(1);
    expect(root).not.toHaveBeenCalled();

    unregisterModal();
    showToast({ type: "info", message: "back on the screen" });
    expect(root).toHaveBeenCalledWith({ type: "info", message: "back on the screen" });
    unregisterRoot();
  });

  it("hands a leaving host's toast to the host below, saying whether it was announced", () => {
    const root = jest.fn();
    const unregisterRoot = registerToastHandler(root);

    handOffToast({ type: "success", message: "Added 3 sessions" }, true);
    expect(root).toHaveBeenCalledWith(
      { type: "success", message: "Added 3 sessions" },
      { alreadyAnnounced: true },
    );
    unregisterRoot();
  });
});

describe("toastDurationMs", () => {
  it("uses the toast's duration, else the default for its type", () => {
    expect(toastDurationMs({ type: "info", message: "x" }, false)).toBe(DEFAULT_TOAST_DURATION_MS);
    expect(toastDurationMs({ type: "error", message: "x" }, false)).toBe(ERROR_TOAST_DURATION_MS);
    expect(toastDurationMs({ type: "info", message: "x", duration: 1200 }, false)).toBe(1200);
  });

  it("keeps a toast up longer while a screen reader is on", () => {
    expect(toastDurationMs({ type: "error", message: "x" }, true)).toBe(
      SCREEN_READER_MIN_TOAST_DURATION_MS,
    );
    expect(toastDurationMs({ type: "info", message: "x", duration: 20000 }, true)).toBe(20000);
  });
});
