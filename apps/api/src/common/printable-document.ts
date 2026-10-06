import PDFDocument from "pdfkit";
import { axoraPdfFont, axoraPdfHeader, axoraPdfFooter } from "./axora-pdf.js";

export interface PrintColumn { label: string; width: number; align?: "left" | "right" }
export interface PrintParty { name: string; address?: string; details?: string[] }
export type PrintMetaItem = readonly [label: string, value: string];
export type PrintTotalRow = readonly [label: string, value: string, emphasized?: boolean];
export type PrintNoticeTone = "info" | "success" | "warning" | "danger";

/** A4 layout shared by server exports. Text is explicitly paginated before the footer. */
export class PrintableDocument {
  readonly pdf = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
  private y = 0;
  private readonly chunks: Buffer[] = [];
  private readonly result: Promise<Buffer>;
  constructor(private readonly title: string, private readonly reference: string, private readonly company: string, private readonly demo = false) {
    this.result = new Promise((resolve, reject) => {
      this.pdf.on("data", (chunk: Buffer) => this.chunks.push(chunk));
      this.pdf.on("end", () => resolve(Buffer.concat(this.chunks)));
      this.pdf.on("error", reject);
    });
    this.header();
  }
  private header() {
    this.y = axoraPdfHeader(this.pdf, this.title, this.reference, this.company) + 6;
    if (this.demo) this.paragraph("DÉMONSTRATION — données fictives", 9, "#92400E");
  }
  private nextPage() { this.pdf.addPage(); this.header(); }
  private room(height: number) { if (this.y + height > 763) this.nextPage(); }
  private wrap(value: string, width: number, size = 9): string[] {
    axoraPdfFont(this.pdf); this.pdf.fontSize(size);
    const lines: string[] = [];
    for (const paragraph of String(value).split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        if (line && this.pdf.widthOfString(`${line} ${word}`) <= width) { line += ` ${word}`; continue; }
        if (line) { lines.push(line); line = ""; }
        let fragment = "";
        for (const character of word) {
          if (fragment && this.pdf.widthOfString(fragment + character) > width) { lines.push(fragment); fragment = ""; }
          fragment += character;
        }
        line = fragment;
      }
      lines.push(line);
    }
    return lines;
  }
  paragraph(value: string, size = 9, color = "#111827") {
    const lines = this.wrap(value, 523, size);
    for (const line of lines) {
      this.room(size + 5);
      this.pdf.fontSize(size).fillColor(color).text(line, 36, this.y, { width: 523, lineBreak: false });
      this.y += size + 4;
    }
    this.y += 6;
  }
  section(title: string, followingHeight = 0) { this.room(42 + followingHeight); this.paragraph(title, 12, "#1E3A8A"); }
  parties(issuer: PrintParty, recipient: PrintParty) {
    const renderParty = (party: PrintParty): string[] => [
      party.name,
      ...this.wrap(party.address ?? "", 233.5, 8),
      ...(party.details ?? []).flatMap((detail) => this.wrap(detail, 233.5, 8)),
    ].filter(Boolean);
    const issuerLines = renderParty(issuer);
    const recipientLines = renderParty(recipient);
    const lineCount = Math.max(issuerLines.length, recipientLines.length, 2);
    const height = 28 + lineCount * 12;
    this.room(height + 12);
    const render = (x: number, label: string, lines: string[]) => {
      this.pdf.roundedRect(x, this.y, 253.5, height, 5).fillAndStroke("#FFFFFF", "#BFC3C9");
      this.pdf.fontSize(7).fillColor("#2563EB").text(label.toUpperCase(), x + 10, this.y + 9, { width: 233.5, lineBreak: false });
      lines.forEach((line, index) => {
        axoraPdfFont(this.pdf);
        this.pdf.fontSize(index === 0 ? 9 : 8).fillColor(index === 0 ? "#111827" : "#4B5563")
          .text(line, x + 10, this.y + 25 + index * 12, { width: 233.5, lineBreak: false, ellipsis: true });
      });
    };
    render(36, "Émetteur", issuerLines);
    render(305.5, "Destinataire", recipientLines);
    this.y += height + 12;
  }
  metaGrid(items: readonly PrintMetaItem[]) {
    if (items.length === 0) return;
    const columns = 2;
    const rows = Math.ceil(items.length / columns);
    const height = rows * 34;
    this.room(height + 10);
    items.forEach(([label, value], index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = 36 + column * 261.5;
      const y = this.y + row * 34;
      this.pdf.rect(x, y, 261.5, 34).fillAndStroke("#F6F8FC", "#D7DCE5");
      this.pdf.fontSize(7).fillColor("#6B7280").text(label.toUpperCase(), x + 8, y + 6, { width: 245.5, lineBreak: false });
      this.pdf.fontSize(8).fillColor("#111827").text(value, x + 8, y + 18, { width: 245.5, lineBreak: false, ellipsis: true });
    });
    this.y += height + 10;
  }
  notice(text: string, tone: PrintNoticeTone = "info") {
    const palette: Record<PrintNoticeTone, [string, string, string]> = {
      info: ["#EFF6FF", "#2563EB", "#1E3A8A"],
      success: ["#ECFDF3", "#067647", "#065F46"],
      warning: ["#FFF7ED", "#B54708", "#92400E"],
      danger: ["#FEF3F2", "#B42318", "#991B1B"],
    };
    const lines = this.wrap(text, 499, 8);
    const height = Math.max(30, lines.length * 11 + 16);
    this.room(height + 8);
    const [background, border, color] = palette[tone];
    this.pdf.roundedRect(36, this.y, 523, height, 5).fillAndStroke(background, border);
    lines.forEach((line, index) => this.pdf.fontSize(8).fillColor(color).text(line, 48, this.y + 9 + index * 11, { width: 499, lineBreak: false }));
    this.y += height + 8;
  }
  totals(rows: readonly PrintTotalRow[]) {
    if (rows.length === 0) return;
    const width = 260;
    const rowHeight = 24;
    const height = rows.length * rowHeight;
    this.room(height + 14);
    const x = 559 - width;
    rows.forEach(([label, value, emphasized], index) => {
      const y = this.y + index * rowHeight;
      this.pdf.rect(x, y, width, rowHeight).fillAndStroke(emphasized ? "#1E3A8A" : "#F6F8FC", emphasized ? "#1E3A8A" : "#D7DCE5");
      const color = emphasized ? "#FFFFFF" : "#111827";
      this.pdf.fontSize(emphasized ? 9 : 8).fillColor(color).text(label, x + 9, y + 7, { width: 140, lineBreak: false });
      this.pdf.text(value, x + 149, y + 7, { width: 102, align: "right", lineBreak: false });
    });
    this.y += height + 14;
  }
  signatures(labels: readonly string[]) {
    if (labels.length === 0) return;
    const gap = 12;
    const width = (523 - gap * (labels.length - 1)) / labels.length;
    const height = 76;
    this.room(height + 8);
    labels.forEach((label, index) => {
      const x = 36 + index * (width + gap);
      this.pdf.roundedRect(x, this.y, width, height, 5).strokeColor("#BFC3C9").stroke();
      this.pdf.fontSize(8).fillColor("#1E3A8A").text(label, x + 8, this.y + 8, { width: width - 16, align: "center", lineBreak: false, ellipsis: true });
      this.pdf.moveTo(x + 16, this.y + 57).lineTo(x + width - 16, this.y + 57).strokeColor("#BFC3C9").stroke();
      this.pdf.fontSize(7).fillColor("#6B7280").text("Nom, date et signature", x + 8, this.y + 62, { width: width - 16, align: "center", lineBreak: false });
    });
    this.y += height + 8;
  }
  table(columns: PrintColumn[], rows: string[][]) {
    const widths = columns.reduce((sum, col) => sum + col.width, 0);
    if (Math.abs(widths - 523) > 0.1) throw new Error("Print table widths must total 523 points");
    const heading = () => {
      this.room(35);
      this.pdf.rect(36, this.y, 523, 28).fill("#1E3A8A");
      let x = 36;
      columns.forEach(col => {
        this.pdf.fontSize(8).fillColor("#FFFFFF").text(col.label, x + 5, this.y + 8, { width: col.width - 10, align: col.align ?? "left", lineBreak: false });
        x += col.width;
      });
      this.y += 28;
    };
    this.room(62); heading();
    rows.forEach((row, rowIndex) => {
      const cells = columns.map((col, index) => this.wrap(row[index] ?? "", col.width - 10, 8));
      const count = Math.max(...cells.map(cell => cell.length), 1);
      const height = count * 11 + 7;
      if (height > 620) throw new Error("Print table row is too tall to fit on one page");
      if (this.y + height > 763) { this.nextPage(); heading(); }
      this.pdf.rect(36, this.y, 523, height).fillAndStroke(rowIndex % 2 ? "#FFFFFF" : "#F3F4F6", "#BFC3C9");
      let x = 36;
      columns.forEach((col, index) => {
        cells[index]?.forEach((line, lineIndex) => {
          this.pdf.fontSize(8).fillColor("#111827").text(line, x + 5, this.y + 4 + lineIndex * 11, { width: col.width - 10, align: col.align ?? "left", lineBreak: false });
        });
        x += col.width;
      });
      this.y += height;
    });
    this.y += 12;
  }
  async finish(): Promise<Buffer> {
    const { count } = this.pdf.bufferedPageRange();
    for (let page = 0; page < count; page += 1) { this.pdf.switchToPage(page); axoraPdfFooter(this.pdf, this.reference, page + 1, count); }
    this.pdf.end();
    return this.result;
  }
}
