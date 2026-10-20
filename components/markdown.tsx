import { Fragment, type ReactNode } from 'react';

/**
 * Small markdown renderer for the assistant's answers: headings, paragraphs, bullet and numbered
 * lists, tables, bold, italic and inline code. No HTML is ever injected.
 */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index} className="rounded bg-secondary px-1 text-[0.85em]">{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const size = heading[1].length <= 2 ? 'text-base' : 'text-sm';
      blocks.push(<p key={index} className={`${size} mt-3 font-semibold`}>{inline(heading[2])}</p>);
      index++;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) rows.push(cells(lines[index++]));
      blocks.push(
        <div key={index} className="my-2 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr>{header.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-border px-2 py-1.5 text-left font-medium">{inline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border last:border-0">
                  {row.map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-1.5 align-top">{inline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/).test(lines[index])) {
        items.push(lines[index].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/, ''));
        index++;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={index} className={`my-1.5 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
        </List>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,4})\s+/.test(lines[index]) && !isTableRow(lines[index]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    blocks.push(<p key={index} className="my-1.5">{paragraph.map((part, partIndex) => <Fragment key={partIndex}>{partIndex > 0 && <br />}{inline(part)}</Fragment>)}</p>);
  }

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
