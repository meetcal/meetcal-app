import { nameMatchesSearchWords, searchWords } from "@/lib/name-search";

const matches = (name: string, query: string) =>
  nameMatchesSearchWords(name, searchWords(query));

describe("searchWords", () => {
  it("trims, lowercases and splits on any whitespace", () => {
    expect(searchWords("  Smith \t John ")).toEqual(["smith", "john"]);
  });

  it("is empty for a blank query", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("nameMatchesSearchWords", () => {
  it("matches every word in any order, ignoring case and stray spaces", () => {
    expect(matches("John Smith", "Smith ")).toBe(true);
    expect(matches("John Smith", "smith john")).toBe(true);
    expect(matches("John Smith", "jo sm")).toBe(true);
  });

  it("needs every word to be present", () => {
    expect(matches("John Smith", "smith jane")).toBe(false);
  });

  it("matches everyone for a blank query", () => {
    expect(matches("John Smith", "  ")).toBe(true);
  });
});
