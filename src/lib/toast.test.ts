import { registerToastHandler, showToast } from "@/lib/toast";

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
