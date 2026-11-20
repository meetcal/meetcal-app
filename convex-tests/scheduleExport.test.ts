import { buildSchedule, type BuilderEntrant } from '../convex/lib/scheduleBuilder';
import { clockLabel, defaultBuilderOptions } from '../convex/lib/scheduleBuilderOptions';
import { inflateRaw } from 'pako';
import { csvCell, exportFileName, scheduleCsv, scheduleWorkbook, sessionRows, startListRows } from '../convex/lib/scheduleExport';
import { columnName, crc32, sheetName, workbook, zip } from '../convex/lib/xlsx';
import { bytesToBase64 } from '../convex/lib/base64';

const entrant = (name: string, gender: string, weightClass: string, entryTotal: number, extra: Partial<BuilderEntrant> = {}): BuilderEntrant => ({
  memberId: `${name.length}${entryTotal}`,
  name,
  age: 30,
  club: 'Iron, "Steel" & Co',
  gender,
  weightClass,
  entryTotal,
  ...extra,
});

const schedule = () =>
  buildSchedule(
    [entrant('Ann', 'Women', '58', 80), entrant('Bea', 'Women', '63', 90), entrant('Cal', 'Men', '89', 150)],
    defaultBuilderOptions({ startDate: '2027-03-06', endDate: '2027-03-06' }),
  );

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function zipEntries(archive: Uint8Array): { name: string; data: string; crc: number }[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const entries = [];
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const packedSize = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = text(archive.subarray(at + 30, at + 30 + nameLength));
    const data = text(inflateRaw(archive.subarray(at + 30 + nameLength, at + 30 + nameLength + packedSize)));
    entries.push({ name, data, crc });
    at += 30 + nameLength + packedSize;
  }
  return entries;
}

describe('clock labels', () => {
  it.each([
    ['09:00:00', '9:00 AM'],
    ['00:05:00', '12:05 AM'],
    ['12:30:00', '12:30 PM'],
    ['17:45:00', '5:45 PM'],
    ['', ''],
  ])('%s reads %s', (stored, label) => {
    expect(clockLabel(stored)).toBe(label);
  });
});

describe('rows', () => {
  it('writes a plus class as 61+, never a leading plus a spreadsheet reads as a number', () => {
    const rows = startListRows(buildSchedule([entrant('Ann', 'Women', '+61', 80), entrant('Bo', 'Men', '+109kg', 200)], defaultBuilderOptions({ startDate: '2027-03-06', endDate: '2027-03-06' })));
    expect(rows.map((row) => [row[5], row[9]])).toEqual([
      ['W 61+', '61+'],
      ['M 109+', '109+'],
    ]);
  });

  it('leaves the member ID blank for an entrant Sport80 lists without one', () => {
    const rows = startListRows(buildSchedule([entrant('Del Mullen', 'Women', '58', 80, { memberId: 'noid:del-mullen' })], defaultBuilderOptions({ startDate: '2027-03-06', endDate: '2027-03-06' })));
    expect(rows[0]?.at(-1)).toBe('');
  });

  it('lists every athlete with their session, platform, times and group', () => {
    expect(startListRows(schedule())).toEqual([
      [1, 'Red', '2027-03-06', '7:00 AM', '9:00 AM', 'W 58, 63', 'Ann', 'Female', 30, '58', 80, 'Iron, "Steel" & Co', '380'],
      [1, 'Red', '2027-03-06', '7:00 AM', '9:00 AM', 'W 58, 63', 'Bea', 'Female', 30, '63', 90, 'Iron, "Steel" & Co', '390'],
      [2, 'Red', '2027-03-06', '9:00 AM', '11:00 AM', 'M 89', 'Cal', 'Male', 30, '89', 150, 'Iron, "Steel" & Co', '3150'],
    ]);
    expect(sessionRows(schedule())).toEqual([
      [1, 'Red', '2027-03-06', '7:00 AM', '9:00 AM', 'W 58, 63', 2],
      [2, 'Red', '2027-03-06', '9:00 AM', '11:00 AM', 'M 89', 1],
    ]);
  });
});

describe('CSV', () => {
  it('quotes cells holding commas, quotes or line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(42)).toBe('42');
  });

  it('keeps text that a spreadsheet would run as a formula as text, leaving numbers and weight classes alone', () => {
    expect(csvCell('=HYPERLINK("https://evil.example","x")')).toBe('"\'=HYPERLINK(""https://evil.example"",""x"")"');
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('-Elite-')).toBe(`"'-Elite-"`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('61+')).toBe('61+');
  });

  it('starts with a byte order mark so Excel reads accents, then a header and one line per athlete', () => {
    const csv = scheduleCsv(schedule());
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Session,Platform,Date,Weigh-In,Start Time,Group,Name,Gender,Age,Weight Class,Entry Total,Club,Member ID');
    expect(lines[1]).toBe('1,Red,2027-03-06,7:00 AM,9:00 AM,"W 58, 63",Ann,Female,30,58,80,"Iron, ""Steel"" & Co",380');
    expect(lines).toHaveLength(4);
  });
});

describe('workbook', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('names columns past Z', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('keeps sheet names to what Excel allows', () => {
    expect(sheetName('Day 1/2: [Women]')).toBe('Day 1 2   Women');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName('  ')).toBe('Sheet');
  });

  it('zips each part, deflated, with its checksum', () => {
    const entries = zipEntries(zip([{ path: 'a.txt', text: 'hello' }]));
    expect(entries).toEqual([{ name: 'a.txt', data: 'hello', crc: crc32(new TextEncoder().encode('hello')) }]);
  });

  it('holds a Sessions and a Start List sheet with numbers as numbers and escaped text', () => {
    const entries = zipEntries(scheduleWorkbook(schedule()));
    expect(entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    const book = entries.find((e) => e.name === 'xl/workbook.xml')?.data ?? '';
    expect(book).toContain('<sheet name="Sessions" sheetId="1" r:id="rId1"/><sheet name="Start List" sheetId="2" r:id="rId2"/>');
    const startList = entries.find((e) => e.name === 'xl/worksheets/sheet2.xml')?.data ?? '';
    expect(startList).toContain('<c r="A2"><v>1</v></c>');
    expect(startList).toContain('<t xml:space="preserve">Iron, &quot;Steel&quot; &amp; Co</t>');
    expect(startList).toContain('<c r="A1" t="inlineStr" s="1">');
  });

  it('keeps the largest roster’s workbook far under the size a Convex answer may have', () => {
    const entrants = Array.from({ length: 10_000 }, (_, i) => entrant(`Lifter Number ${i}`, i % 2 ? 'Men' : 'Women', String(40 + (i % 60)), i % 300, { memberId: String(100000 + i) }));
    const days = Array.from({ length: 7 }, (_, i) => ({ date: `2027-03-0${i + 1}`, firstStart: '07:00' }));
    const large = buildSchedule(entrants, { ...defaultBuilderOptions({ startDate: '2027-03-01', endDate: '2027-03-07' }), days, sessionMinutes: 60, maxAthletesPerPlatform: 20, platforms: ['A', 'B', 'C', 'D', 'E', 'F'] });
    expect(bytesToBase64(scheduleWorkbook(large)).length).toBeLessThan(2_000_000);
  });

  it('drops characters XML cannot hold', () => {
    const [sheet] = zipEntries(workbook([{ name: 'S', rows: [['a\u0001b']] }])).filter((e) => e.name.endsWith('sheet1.xml'));
    expect(sheet?.data).toContain('>ab<');
  });
});

describe('files', () => {
  it('names the file after the meet', () => {
    expect(exportFileName('2026 Turkey Cup: Fall!', 'csv')).toBe('2026-turkey-cup-fall-schedule.csv');
    expect(exportFileName('Café Open', 'xlsx')).toBe('cafe-open-schedule.xlsx');
    expect(exportFileName('!!!', 'xlsx')).toBe('meet-schedule.xlsx');
  });

  it('encodes bytes as base64, past one chunk', () => {
    expect(bytesToBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(Buffer.from(bytesToBase64(big), 'base64').equals(Buffer.from(big))).toBe(true);
  });
});
