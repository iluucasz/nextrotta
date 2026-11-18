// Types only: the SheetJS library itself (large) is fetched when a file is actually read.
import type * as XLSX from 'xlsx';

/** UTF-8 when the bytes are valid UTF-8 (Google Sheets, "CSV UTF-8"), otherwise Windows-1252 (Excel's plain CSV). */
export function decodeTextFile(buffer: ArrayBuffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export function isTextSpreadsheet(fileName: string) {
  return /\.(csv|txt)$/i.test(fileName);
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Date cells as Brazilian text. SheetJS formats a date cell with Excel's built-in short format as
 * month/day/year ("10/5/26" for 5 October), which a day/month/year reader takes for 10 May. The
 * cell's real date is known, so its displayed text is replaced by dd/mm/aaaa (plus HH:mm when it
 * has a time; HH:mm alone for a time-only cell). Read the sheet with `raw: false` afterwards.
 */
export function applyBrazilianDateText(workbook: XLSX.WorkBook) {
  for (const worksheet of Object.values(workbook.Sheets)) {
    for (const [address, cell] of Object.entries(worksheet)) {
      if (address.startsWith('!') || !cell || typeof cell !== 'object') continue;
      const value = (cell as XLSX.CellObject).v;
      if ((cell as XLSX.CellObject).t !== 'd' || !(value instanceof Date) || Number.isNaN(value.getTime())) continue;

      const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
      const date = `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
      (cell as XLSX.CellObject).w = value.getFullYear() < 1900 ? time : time === '00:00' ? date : `${date} ${time}`;
    }
  }
  return workbook;
}

/**
 * Rows of text copied from a spreadsheet or a web table (tab-separated, as Excel, Google Sheets and
 * browsers put it on the clipboard; ";" or "," as a fallback for pasted CSV). The first line holds the
 * column titles. Values stay text, so dates and amounts are read as Brazilian ones by the importer.
 */
export function parsePastedTable(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.split('\n', 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

  const table: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      table.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  table.push(row);

  const lines = table.filter((cells) => cells.some((value) => value.trim() !== ''));
  if (lines.length < 2) return [];

  const headers = lines[0].map((header) => header.trim());
  return lines.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, position) => {
      if (header) record[header] = (cells[position] ?? '').trim();
    });
    return record;
  });
}

/**
 * Reads an uploaded spreadsheet. A CSV is plain text: it is decoded here (SheetJS assumes
 * Windows-1252) and kept as text, because SheetJS would otherwise guess US types ("05/10/2026"
 * becomes May 10, "500,00" becomes 50000). Excel files keep their real dates.
 */
export async function readSpreadsheet(buffer: ArrayBuffer, fileName: string) {
  const sheetjs = await import('xlsx');
  return isTextSpreadsheet(fileName)
    ? sheetjs.read(decodeTextFile(buffer), { type: 'string', cellDates: true, raw: true })
    : sheetjs.read(buffer, { type: 'array', cellDates: true });
}
