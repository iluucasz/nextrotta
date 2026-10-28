import * as XLSX from 'xlsx';

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
 * Reads an uploaded spreadsheet. A CSV is plain text: it is decoded here (SheetJS assumes
 * Windows-1252) and kept as text, because SheetJS would otherwise guess US types ("05/10/2026"
 * becomes May 10, "500,00" becomes 50000). Excel files keep their real dates.
 */
export function readSpreadsheet(buffer: ArrayBuffer, fileName: string) {
  return isTextSpreadsheet(fileName)
    ? XLSX.read(decodeTextFile(buffer), { type: 'string', cellDates: true, raw: true })
    : XLSX.read(buffer, { type: 'array', cellDates: true });
}
