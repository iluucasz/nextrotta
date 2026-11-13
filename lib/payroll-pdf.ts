// The folha as a real PDF file (downloaded directly, no print dialog). Drawn with jsPDF in the browser; the
// library is loaded only when someone asks for a PDF. It is the technician's copy: it never shows what the
// folha costs the company or the company's profit.

export type PayrollPdfLine = { label: string; value: number };

export type PayrollPdfData = {
  organizationName: string | null;
  technicianName: string;
  technicianQra: string;
  /** "Outubro de 2026" */
  competenceLabel: string;
  /** "2026-10": used in the file name. */
  competenceMonth: string;
  /** When the folha was closed (ISO), if known. */
  closedAt: string | null;
  netTotal: number;
  earnings: PayrollPdfLine[];
  deductions: PayrollPdfLine[];
  cards: PayrollPdfLine[];
  /** Heading and total label of the vouchers block (cards by default; "Dinheiro à parte" when paid in cash). */
  cardsTitle?: string;
  cardsTotalLabel?: string;
  production: { serviceCount: number; total: number; fortnights: Array<{ label: string; count: number; value: number }> };
  hourBank: number;
};

const INK: [number, number, number] = [27, 26, 46];
const MUTED: [number, number, number] = [107, 107, 128];
const RULE: [number, number, number] = [228, 228, 236];
const ACCENT: [number, number, number] = [109, 94, 247];

const PAGE_WIDTH = 210;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ROW_HEIGHT = 7.2;

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// jsPDF's built-in font has no non-breaking space or typographic minus: plain space and hyphen.
const money = (value: number) => currency.format(value).replace(/ /g, ' ').replace(/−/g, '-');
const hours = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
const sum = (lines: PayrollPdfLine[]) => Math.round(lines.reduce((total, line) => total + line.value, 0) * 100) / 100;

function fileNameFor(data: PayrollPdfData) {
  const name = data.technicianName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, ' ');
  return `Folha - ${name || 'tecnico'} - ${data.competenceMonth}.pdf`;
}

export async function downloadPayrollPdf(data: PayrollPdfData) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 20;

  const color = (rgb: [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const text = (value: string, x: number, size: number, style: 'normal' | 'bold', rgb: [number, number, number], align: 'left' | 'right' | 'center' = 'left') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    color(rgb);
    doc.text(value, x, y, { align });
  };
  const rule = (at: number) => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, at, MARGIN + CONTENT_WIDTH, at);
  };
  const ensureRoom = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 20;
    }
  };

  /** A titled group of lines: label on the left, amount on the right, optional bold total underneath. */
  const section = (title: string, lines: Array<{ label: string; value: string }>, total?: { label: string; value: string }, empty?: string) => {
    ensureRoom(14 + Math.max(lines.length, 1) * ROW_HEIGHT + (total ? ROW_HEIGHT + 2 : 0));
    text(title, MARGIN, 11, 'bold', INK);
    y += 3;
    rule(y);

    if (!lines.length) {
      y += ROW_HEIGHT - 1;
      text(empty ?? 'Nada lançado', MARGIN, 10, 'normal', MUTED);
      y += 3;
    }
    for (const line of lines) {
      y += ROW_HEIGHT - 1;
      text(line.label, MARGIN, 10, 'normal', INK);
      text(line.value, MARGIN + CONTENT_WIDTH, 10, 'normal', INK, 'right');
      y += 2.5;
      rule(y);
    }
    if (total) {
      y += ROW_HEIGHT - 1;
      text(total.label, MARGIN, 10, 'bold', INK);
      text(total.value, MARGIN + CONTENT_WIDTH, 10, 'bold', INK, 'right');
      y += 2.5;
    }
    y += 6;
  };

  // Header: who it is from, and which month
  text(data.organizationName || 'Folha de pagamento', MARGIN, 12, 'bold', INK);
  text(data.competenceLabel, MARGIN + CONTENT_WIDTH, 12, 'bold', INK, 'right');
  y += 5.5;
  text(data.organizationName ? 'Folha de pagamento' : '', MARGIN, 9, 'normal', MUTED);
  const closed = data.closedAt ? new Date(data.closedAt) : null;
  text(closed && !Number.isNaN(closed.getTime()) ? `Fechada em ${closed.toLocaleDateString('pt-BR')}` : '', MARGIN + CONTENT_WIDTH, 9, 'normal', MUTED, 'right');
  y += 5;
  rule(y);

  // The technician
  y += 14;
  text(data.technicianName, MARGIN, 20, 'bold', INK);
  if (data.technicianQra) {
    y += 7;
    text(`QRA ${data.technicianQra}`, MARGIN, 10, 'normal', MUTED);
  }

  // The one number that matters
  y += 9;
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 24, 3, 3, 'F');
  y += 10;
  text('Valor em conta', MARGIN + 7, 11, 'normal', [255, 255, 255]);
  y += 5;
  text('Ganhos menos descontos', MARGIN + 7, 8.5, 'normal', [226, 222, 255]);
  y -= 3;
  text(money(data.netTotal), MARGIN + CONTENT_WIDTH - 7, 21, 'bold', [255, 255, 255], 'right');
  y += 20;

  const earnings = data.earnings.filter((line) => line.value !== 0);
  const deductions = data.deductions.filter((line) => line.value !== 0);
  const cards = data.cards.filter((line) => line.value !== 0);

  section(
    'Ganhos',
    earnings.map((line) => ({ label: line.label, value: money(line.value) })),
    { label: 'Total de ganhos', value: money(sum(data.earnings)) },
    'Nenhum ganho lançado',
  );
  section(
    'Descontos',
    deductions.map((line) => ({ label: line.label, value: `- ${money(line.value)}` })),
    deductions.length ? { label: 'Total de descontos', value: `- ${money(sum(data.deductions))}` } : undefined,
    'Nenhum desconto neste mês',
  );
  if (cards.length) {
    section(
      data.cardsTitle ?? 'Cartões (pagos à parte)',
      cards.map((line) => ({ label: line.label, value: money(line.value) })),
      cards.length > 1 ? { label: data.cardsTotalLabel ?? 'Total nos cartões', value: money(sum(data.cards)) } : undefined,
    );
  }

  const production = [
    { label: 'Ordens de serviço', value: String(data.production.serviceCount) },
    { label: 'Valor bruto', value: money(data.production.total) },
    ...data.production.fortnights.map((item) => ({ label: `${item.label} (${item.count} OS)`, value: money(item.value) })),
  ];
  section('Produção do mês', production);

  section('Banco de horas', [{ label: 'Saldo acumulado', value: hours(data.hourBank) }]);

  // Footer on every page
  const generated = new Date();
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    y = 287;
    text(
      `Gerado em ${generated.toLocaleDateString('pt-BR')} às ${generated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${pages > 1 ? `  ·  ${page}/${pages}` : ''}`,
      PAGE_WIDTH / 2,
      8,
      'normal',
      MUTED,
      'center',
    );
  }

  doc.save(fileNameFor(data));
}
