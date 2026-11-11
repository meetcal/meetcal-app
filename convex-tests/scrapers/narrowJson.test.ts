import { entryFromRow, readEntriesTable } from '../../convex/scrapers/parse/entries';
import { wikitextOf } from '../../convex/scrapers/parse/iwfRecords';
import { pageRows, readSport80Env, readTablePage } from '../../convex/scrapers/parse/sport80';

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

  it('keeps a row id as sent, so ids that are not numbers still tell rows apart', () => {
    const table = readEntriesTable({ total: 2, data: [{ ...row, id: 'a1' }, { ...row, id: 'b2' }] });
    expect(table.data!.map((entry) => entry.id)).toEqual(['a1', 'b2']);
  });

  it('names the field that is not what the sync reads', () => {
    expect(() => readEntriesTable([row])).toThrow('entries: the response is not an object');
    expect(() => readEntriesTable({ data: { 0: row } })).toThrow('entries: data is not a list');
    expect(() => readEntriesTable({ total: 'many', data: [] })).toThrow('entries: total is not a row count ("many")');
    expect(() => readEntriesTable({ data: [row, { ...row, first_name: 5 }] })).toThrow('entries: row 1: first_name is a number');
    expect(() => readEntriesTable({ data: [{ ...row, member_id: { n: 1 } }] })).toThrow('entries: row 0: member_id is a object');
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
    expect(() => readSport80Env('{"RANKINGS_DOMAIN_URL":"https://x.test","SERVICES_API_PUBLIC_KEY":5}')).toThrow('window.env has no SERVICES_API_PUBLIC_KEY');
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
    expect(() => wikitextOf({ parse: { wikitext: { '*': 'old format' } } }, 'Page')).toThrow('Wikipedia Page: wikitext is a object');
    expect(() => wikitextOf({}, 'Page')).toThrow('Wikipedia Page: no wikitext');
    expect(() => wikitextOf('<html>', 'Page')).toThrow('Wikipedia Page: the response is not an object');
  });
});
