import { kindOf } from '../../convex/lib/json';
import { entryFromRow, readEntriesTable } from '../../convex/scrapers/parse/entries';
import { wikitextOf } from '../../convex/scrapers/parse/iwfRecords';
import { readWidgetPage } from '../../convex/scrapers/parse/meets';
import { pageRows, readSport80Env, readTablePage } from '../../convex/scrapers/parse/sport80';
import { joinPages, tableComplete } from '../../convex/scrapers/sport80';

describe('naming what a value is', () => {
  it('names each kind the way an error reads it', () => {
    expect([null, undefined, [], {}, 'x', 1, true].map(kindOf)).toEqual(['null', 'missing', 'a list', 'an object', 'a string', 'a number', 'a boolean']);
  });
});

describe('the entries table', () => {
  const row = { id: 7, member_id: '1012345', first_name: 'Ann', last_name: 'Lee', weightlifting_age: 31, club: 'Club', gender: 'Female', weight_class: '63', entry_total: '150' };

  it('reads a page as Sport80 sends it', () => {
    const table = readEntriesTable({ title: 'Open - Members', total: 1, data: [row] });
    expect(table).toEqual({ title: 'Open - Members', total: 1, data: [row] });
    expect(entryFromRow(table.data![0], 'Open')).toMatchObject({ memberId: '1012345', name: 'Ann Lee', age: 31, entryTotal: 150 });
  });

  it('takes a membership number sent as a number, which used to fail the target with "trim is not a function"', () => {
    const table = readEntriesTable({ total: '1', data: [{ ...row, member_id: 1012345 }] });
    expect(table.total).toBe(1);
    expect(entryFromRow(table.data![0], 'Open').memberId).toBe('1012345');
  });

  it('keeps a row id as sent, so ids of any kind still tell rows apart', () => {
    const { id: _id, ...withoutId } = row;
    const table = readEntriesTable({ total: 4, data: [{ ...row, id: 'a1' }, { ...row, id: 'b2' }, { ...row, id: null }, withoutId] });
    expect(table.data!.map((entry) => ('id' in entry ? entry.id : 'absent'))).toEqual(['a1', 'b2', null, 'absent']);
  });

  it('reads an age or entry total that is neither a number nor text as missing, as before, and ignores a title that is not text', () => {
    const table = readEntriesTable({ title: 7, data: [{ ...row, weightlifting_age: true, entry_total: { kg: 150 } }] });
    expect(table.title).toBeUndefined();
    expect(entryFromRow(table.data![0], 'Open')).toMatchObject({ age: 0, entryTotal: 0 });
  });

  it('names the field that is not what the sync reads', () => {
    expect(() => readEntriesTable([row])).toThrow('entries: the response is not an object');
    expect(() => readEntriesTable({ data: { 0: row } })).toThrow('entries: data is not a list');
    expect(() => readEntriesTable({ total: 'many', data: [] })).toThrow('entries: total is not a row count ("many")');
    expect(() => readEntriesTable({ data: [row, { ...row, first_name: 5 }] })).toThrow('entries: row 1: first_name is a number');
    expect(() => readEntriesTable({ data: [{ ...row, member_id: { n: 1 } }] })).toThrow('entries: row 0: member_id is an object');
    expect(() => readEntriesTable({ data: ['x'] })).toThrow('entries: row 0 is not an object');
  });

  it('keeps a page without rows, a title or a count as one', () => {
    expect(readEntriesTable({})).toEqual({});
    expect(readEntriesTable({ title: null, total: null, data: null })).toEqual({});
  });
});

describe("Sport80's window.env and tables", () => {
  it('needs the API address and key, once, by name', () => {
    expect(readSport80Env('{"RANKINGS_DOMAIN_URL":"https://x.test","SERVICES_API_PUBLIC_KEY":"k","OTHER":1}')).toEqual({ RANKINGS_DOMAIN_URL: 'https://x.test', SERVICES_API_PUBLIC_KEY: 'k' });
    expect(() => readSport80Env('{"SERVICES_API_PUBLIC_KEY":"k"}')).toThrow('window.env has no RANKINGS_DOMAIN_URL');
    expect(readSport80Env('{"RANKINGS_DOMAIN_URL":"https://x.test","SERVICES_API_PUBLIC_KEY":5}').SERVICES_API_PUBLIC_KEY).toBe('5');
    expect(() => readSport80Env('{"RANKINGS_DOMAIN_URL":"https://x.test","SERVICES_API_PUBLIC_KEY":null}')).toThrow('window.env has no SERVICES_API_PUBLIC_KEY');
    expect(() => readSport80Env('{"RANKINGS_DOMAIN_URL":"rankings","SERVICES_API_PUBLIC_KEY":"k"}')).toThrow('RANKINGS_DOMAIN_URL is not a URL');
    expect(() => readSport80Env('[]')).toThrow('not an object');
    expect(() => readSport80Env('{oops')).toThrow('not JSON');
  });

  it('reads a table page\'s rows, and refuses data that is not a list of rows', () => {
    expect(pageRows(readTablePage({ data: [{ a: 1 }], total: 1 }))).toEqual([{ a: 1 }]);
    expect(pageRows({})).toEqual([]);
    expect(() => readTablePage(['row'])).toThrow('a list, not an object');
    expect(() => pageRows({ data: { 0: { a: 1 } } })).toThrow('not a list of rows');
    expect(() => pageRows({ data: [{ a: 1 }, 'x'] })).toThrow('row 1 is not an object');
  });
});

describe("Wikipedia's parse answer", () => {
  it('gives the wikitext, or says what came instead', () => {
    expect(wikitextOf({ parse: { wikitext: '== Current records ==' } }, 'Page')).toBe('== Current records ==');
    expect(() => wikitextOf({ error: { info: 'The page you specified does not exist.' } }, 'Page')).toThrow('Wikipedia Page: The page you specified does not exist.');
    expect(() => wikitextOf({ parse: { wikitext: { '*': 'old format' } } }, 'Page')).toThrow('Wikipedia Page: wikitext is an object');
    expect(() => wikitextOf({}, 'Page')).toThrow('Wikipedia Page: no wikitext');
    expect(() => wikitextOf('<html>', 'Page')).toThrow('Wikipedia Page: the response is not an object');
  });
});

describe('row counts across the Sport80 readers', () => {
  it('reads a results table count sent as digits in text, as the entries list and the widget do', () => {
    expect(tableComplete(2, '2')).toBe(true);
    expect(joinPages([[{ a: 1 }], [{ a: 2 }]], '2')).toEqual({ rows: [{ a: 1 }, { a: 2 }] });
    expect(() => joinPages([[{ a: 1 }]], '2')).toThrow('read 1 rows of the 2 the table reports');
    expect(joinPages([[{ a: 1 }]], undefined).notWhole).toBe('the table reports no row count');
    expect(joinPages([[{ a: 1 }]], 'many').notWhole).toBe('the table reports no row count');
    expect(() => joinPages([[{ a: 1 }]], -1)).toThrow('read 1 rows of the -1 the table reports');
    expect(() => joinPages([[{ a: 1 }]], 1.5)).toThrow('read 1 rows of the 1.5 the table reports');
  });

  it('refuses a widget listing with a negative count', () => {
    expect(() => readWidgetPage({ total: -1, data: [] })).toThrow('widget: no match count (total -1)');
    expect(readWidgetPage({ total: '0', data: [] })).toEqual({ total: 0, rows: [] });
  });
});
