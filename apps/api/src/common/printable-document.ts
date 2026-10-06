import PDFDocument from "pdfkit";
import { axoraPdfFont, axoraPdfHeader, axoraPdfFooter } from "./axora-pdf.js";

export interface PrintColumn { label: string; width: number; align?: "left" | "right" }

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
  section(title: string) { this.room(42); this.paragraph(title, 12, "#1E3A8A"); }
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
      let offset = 0;
      while (offset < count) {
        if (this.y + 24 > 763) { this.nextPage(); heading(); }
        const capacity = Math.max(1, Math.floor((763 - this.y - 10) / 12));
        const take = Math.min(capacity, count - offset);
        const height = take * 12 + 10;
        this.pdf.rect(36, this.y, 523, height).fillAndStroke(rowIndex % 2 ? "#FFFFFF" : "#F3F4F6", "#BFC3C9");
        let x = 36;
        columns.forEach((col, index) => {
          for (let j = 0; j < take; j += 1) {
            this.pdf.fontSize(8).fillColor("#111827").text(cells[index]?.[offset + j] ?? "", x + 5, this.y + 5 + j * 12, { width: col.width - 10, align: col.align ?? "left", lineBreak: false });
          }
          x += col.width;
        });
        this.y += height; offset += take;
      }
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
