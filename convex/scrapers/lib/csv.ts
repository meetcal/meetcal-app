/**
 * CSV rows as Python's `csv.reader` reads them (the default dialect):
 * comma-separated, `"` quoting with `""` for a literal quote, newlines
 * inside quotes kept, `\r\n` or `\n` ending a row. A blank line is an empty
 * row (`[]`), as in Python.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      fieldStarted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      fieldStarted = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rows.push(fieldStarted || field !== '' ? [...row, field] : []);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (fieldStarted || field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}
