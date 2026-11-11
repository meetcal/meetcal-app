import React from "react";
import { act, create } from "react-test-renderer";

import { RecordsTable } from "./RecordsTable";

jest.mock("@shopify/flash-list", () => ({ FlashList: () => null }));
jest.mock("@/hooks/useAppColors", () => ({
  useAppColors: () => new Proxy({}, { get: () => "#000000" }),
}));

function textOf(records: React.ComponentProps<typeof RecordsTable>["records"], unit?: string): string {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <RecordsTable
        records={records}
        rowKeyPrefix="USAW-Senior-Men"
        weightClassUnit={unit}
        loading={false}
        error={null}
        emptyMessage="No records"
      />,
    );
  });
  const text = JSON.stringify(tree.toJSON());
  act(() => tree.unmount());
  return text;
}

describe("RecordsTable", () => {
  const records = [
    { weightClass: "60", snatchRecord: 126, cjRecord: 166, totalRecord: 293 },
    { weightClass: "60", snatchRecord: null, cjRecord: 0, totalRecord: 300 },
  ];

  it("shows each record's lifts and adds the unit a table asks for", () => {
    const text = textOf(records, "kg");

    expect(text).toContain("60kg");
    expect(text).toContain("126kg");
    expect(text).toContain("293kg");
  });

  it("shows the weight class as stored when no unit is asked for", () => {
    expect(textOf([{ weightClass: "110+kg", snatchRecord: 187, cjRecord: 233, totalRecord: 418 }])).toContain("110+kg");
  });

  it("renders two rows of the same weight class without a key collision", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);

    textOf(records);

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("shows the empty message for no records", () => {
    expect(textOf([])).toContain("No records");
  });
});
