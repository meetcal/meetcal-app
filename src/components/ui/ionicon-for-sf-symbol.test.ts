import { ioniconFor } from "./ionicon-for-sf-symbol";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: { glyphMap: { "chevron-down": 1, search: 2, star: 3, home: 4 } },
}));

describe("ioniconFor", () => {
  it("maps an SF Symbol name to its Ionicons equivalent", () => {
    expect(ioniconFor("chevron.down")).toBe("chevron-down");
    expect(ioniconFor("magnifyingglass")).toBe("search");
    expect(ioniconFor("star.fill")).toBe("star");
  });

  it("passes through a name Ionicons already has", () => {
    expect(ioniconFor("home")).toBe("home");
  });

  it("draws nothing for a name neither table knows", () => {
    expect(ioniconFor("person.crop.circle.badge.questionmark")).toBeNull();
  });
});
