import ExcelJS from "exceljs";
import { AXORA_BRAND, type DqeView } from "@axora24/contracts";
import { PrintableDocument } from "../common/printable-document.js";

const state = (dqe: DqeView) => dqe.status === "DRAFT" ? "BROUILLON — document non finalisé" : dqe.status === "FINALIZED" ? "FINALISÉ" : "ARCHIVÉ";
const metadata = (dqe: DqeView) => `${dqe.code} · Révision ${dqe.revision} · ${state(dqe)}`;
const categoryLabels: Record<string, string> = {
  MATERIAL: "Matériaux", LABOR: "Main-d’œuvre", EQUIPMENT: "Matériel", SUBCONTRACTING: "Sous-traitance", OTHER: "Autres",
};
const categoryLabel = (value: DqeView["lines"][number]["costCategory"]): string => categoryLabels[value ?? "OTHER"] ?? "Autres";
const rate = (value: string | undefined) => value ?? "0.000000";
const amount = (value: string | undefined) => value ?? "0.000000";

/** Values remain explicit strings: Excel's 15-digit numeric limit must not alter source decimals. */
export async function dqeWorkbook(dqe: DqeView, companyName: string, demo = false): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AXORA-ERP24";
  workbook.title = `${dqe.code} — ${dqe.title}`;
  const sheet = workbook.addWorksheet("DQE", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:8" },
    views: [{ state: "frozen", ySplit: 8 }],
  });
  sheet.columns = [{ width: 8 }, { width: 48 }, { width: 20 }, { width: 12 }, { width: 21 }, { width: 24 }, { width: 24 }];
  sheet.addRows([
    [`AXORA-ERP24 — DQE / BPU${demo ? " — DÉMONSTRATION" : ""}`], [companyName], [metadata(dqe)], [dqe.title],
    [`Devise : ${dqe.currency}`], [`Source : ${dqe.source?.studyCode ?? "saisie directe"}`], [],
    ["N°", "Désignation", "Catégorie", "Unité", "Quantité", "Prix unitaire HT", "Montant HT"],
  ]);
  for (let row = 1; row <= 6; row += 1) sheet.mergeCells(row, 1, row, 6);
  sheet.headerFooter.oddFooter = `&LAXORA GROUP&C${AXORA_BRAND.phone} · ${AXORA_BRAND.email} · axora.cd&R&P / &N`;
  sheet.headerFooter.evenFooter = sheet.headerFooter.oddFooter;
  sheet.getRow(4).height = 30;
  sheet.getCell("A4").alignment = { wrapText: true };
  sheet.getCell("A1").font = { name: "Arial", bold: true, size: 16, color: { argb: "FF1E3A8A" } };
  const logo = workbook.addImage({ filename: require.resolve("@axora24/contracts/assets/axora-logo.png"), extension: "png" });
  sheet.addImage(logo, { tl: { col: 5, row: 0 }, ext: { width: 72, height: 72 } });
  sheet.getCell("A3").font = { bold: true, color: { argb: dqe.status === "DRAFT" ? "FF92400E" : "FF1E3A8A" } };
  sheet.getRow(8).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  });
  sheet.autoFilter = "A8:G8";
  for (const line of dqe.lines) {
    // Excel caps row height at 409 points. Continue long descriptions on separate
    // rows so printouts preserve every word without duplicating amounts.
    const descriptions: string[] = [];
    let remaining = line.designation;
    while (remaining.length > 1000) {
      const whitespace = remaining.lastIndexOf(" ", 1000);
      const end = whitespace > 650 ? whitespace : 1000;
      descriptions.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trimStart();
    }
    descriptions.push(remaining);
    descriptions.forEach((description, index) => {
      const row = sheet.addRow(index === 0
        ? [line.position, description, categoryLabel(line.costCategory), line.unitCode, line.quantity, line.unitPrice, line.lineTotal]
        : [null, description, null, null, null, null, null]);
      row.height = Math.max(30, Math.ceil(description.length / 50) * 15);
      row.eachCell((cell, column) => {
        cell.alignment = { vertical: "top", wrapText: true, horizontal: column >= 4 ? "right" : "left" };
        if (column >= 4) cell.numFmt = "@";
      });
    });
  }
  const total = sheet.addRow([null, null, null, null, null, `TOTAL DIRECT HT (${dqe.currency})`, dqe.subtotal]);
  total.font = { bold: true, color: { argb: "FF1E3A8A" } };
  total.getCell(7).numFmt = "@";
  for (const [label, value] of [
    [`Frais généraux (${rate(dqe.overheadRate)} %)`, amount(dqe.overheadAmount)],
    [`Base après frais généraux`, amount(dqe.costBase)],
    [`Marge (${rate(dqe.marginRate)} %)`, amount(dqe.marginAmount)],
    [`Total taxable (${dqe.currency})`, amount(dqe.taxableTotal)],
    [`Taxe (${rate(dqe.taxRate)} %)`, amount(dqe.taxAmount)],
    [`TOTAL TTC (${dqe.currency})`, amount(dqe.total)],
  ]) {
    const row = sheet.addRow([null, null, null, null, null, label, value]);
    row.getCell(7).numFmt = "@";
    if ((label ?? "").startsWith("TOTAL")) row.font = { bold: true, color: { argb: "FF1E3A8A" } };
  }
  const note = sheet.addRow(["Les décimales exactes sont conservées comme textes. Les totaux sont calculés par AXORA."]);
  sheet.mergeCells(note.number, 1, note.number, 7);
  note.getCell(1).alignment = { wrapText: true };
  for (const text of [AXORA_BRAND.address, `${AXORA_BRAND.phone} · ${AXORA_BRAND.email} · axora.cd`]) {
    const footer = sheet.addRow([text]);
    sheet.mergeCells(footer.number, 1, footer.number, 7);
    footer.getCell(1).alignment = { wrapText: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function dqePdf(dqe: DqeView, companyName: string, demo = false): Promise<Buffer> {
  const doc = new PrintableDocument("DQE / BPU", metadata(dqe), companyName, demo);
  doc.paragraph(dqe.title, 14, "#1E3A8A");
  doc.paragraph(`Devise : ${dqe.currency} · Source : ${dqe.source?.studyCode ?? "saisie directe"}`);
  doc.table([
    { label: "N°", width: 28 }, { label: "Désignation", width: 150 }, { label: "Catégorie", width: 60 }, { label: "Unité", width: 36 },
    { label: "Quantité", width: 80, align: "right" }, { label: "PU HT", width: 84, align: "right" },
    { label: "Montant HT", width: 84, align: "right" },
  ], dqe.lines.map(line => [String(line.position), line.designation, categoryLabel(line.costCategory), line.unitCode, line.quantity, line.unitPrice, line.lineTotal]));
  doc.paragraph(`TOTAL DIRECT HT : ${dqe.subtotal} ${dqe.currency}`, 12, "#1E3A8A");
  doc.paragraph(`Frais généraux (${rate(dqe.overheadRate)} %) : ${amount(dqe.overheadAmount)} ${dqe.currency}`);
  doc.paragraph(`Marge (${rate(dqe.marginRate)} %) : ${amount(dqe.marginAmount)} ${dqe.currency}`);
  doc.paragraph(`Taxe (${rate(dqe.taxRate)} %) : ${amount(dqe.taxAmount)} ${dqe.currency}`);
  doc.paragraph(`TOTAL TTC : ${amount(dqe.total)} ${dqe.currency}`, 13, "#1E3A8A");
  return doc.finish();
}
