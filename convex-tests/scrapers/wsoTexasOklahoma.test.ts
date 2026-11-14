import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchText } from '../../convex/scrapers/lib/http';
import { gvizCsvByGid, sheetExportCsvByGid, sheetHtmlViewUrl } from '../../convex/scrapers/parse/wso/common';
import { parseUsawTemplate } from '../../convex/scrapers/parse/wso/usawTemplate';
import { WSO_SOURCES } from '../../convex/scrapers/wsoRecords';

jest.mock('../../convex/scrapers/lib/http', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/http'),
  fetchText: jest.fn(),
}));

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const SHEET_ID = '1gbLq6S4ebW7SGJy4ZyYJZ7ZjOCLjBedjIJzfp9AqIpI';
const DETAILED_GID = '1649080864';
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${DETAILED_GID}`;
const FULL_EXPORT = fixture('texas-oklahoma-detailed-export-20261114.csv');
const FILTERED = fixture('texas-oklahoma-detailed-gviz-filtered-20261114.csv');

const SHEET = new Map([
  [sheetHtmlViewUrl(SHEET_ID), fixture('sheet-tabs-texas-oklahoma-20261114.html')],
  [gvizCsvByGid(SHEET_ID, DETAILED_GID), FILTERED],
  [sheetExportCsvByGid(SHEET_ID, DETAILED_GID), FULL_EXPORT],
]);

const textMock = jest.mocked(fetchText);

const texasOklahoma = () => {
  const found = WSO_SOURCES.find((s) => s.wso === 'Texas-Oklahoma');
  if (!found) throw new Error('no source for Texas-Oklahoma');
  return found;
};

const classesOf = (records: { ageCategory: string; gender: string; weightClass: string }[]) => new Set(records.map((r) => `${r.ageCategory}|${r.gender}|${r.weightClass}`));

describe('Texas-Oklahoma WSO records, with a filter left on the sheet', () => {
  beforeEach(() => {
    textMock.mockReset().mockImplementation(async (url: string) => {
      const body = SHEET.get(url);
      if (body === undefined) throw new Error(`unexpected request ${url}`);
      return body;
    });
  });

  it('builds the export URL of a tab by gid', () => {
    expect(sheetExportCsvByGid('abc', '7')).toBe('https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=7');
  });

  it('serves through gviz only the rows the filter shows, and through export every class', () => {
    const filtered = classesOf(parseUsawTemplate(FILTERED, 'Texas-Oklahoma').records);
    const full = classesOf(parseUsawTemplate(FULL_EXPORT, 'Texas-Oklahoma').records);
    expect(new Set([...filtered].map((key) => key.split('|')[0]))).toEqual(new Set(['Masters 50', 'Masters 55']));
    expect(filtered.size).toBe(16);
    expect(full.size).toBe(298);
    expect([...filtered].every((key) => full.has(key))).toBe(true);
  });

  it("reads the Detailed tab's export after checking the tab is visible, getting all 298 classes", async () => {
    const records = await texasOklahoma().scrape();
    expect(records).toHaveLength(298);
    expect(textMock.mock.calls.map(([url]) => url)).toEqual([sheetHtmlViewUrl(SHEET_ID), EXPORT_URL]);
    expect(classesOf(records).size).toBe(298);
    expect(new Set(records.map((r) => r.wso))).toEqual(new Set(['Texas-Oklahoma']));
  });

  it('fails when the Detailed tab is no longer visible', async () => {
    const hidden = fixture('sheet-tabs-texas-oklahoma-20261114.html').replaceAll(DETAILED_GID, '1');
    textMock.mockImplementation(async (url: string) => (url === sheetHtmlViewUrl(SHEET_ID) ? hidden : FULL_EXPORT));
    await expect(texasOklahoma().scrape()).rejects.toThrow(`tab gid ${DETAILED_GID} is not one of the sheet's visible tabs (hidden or deleted?)`);
    expect(textMock).toHaveBeenCalledTimes(1);
  });
});
