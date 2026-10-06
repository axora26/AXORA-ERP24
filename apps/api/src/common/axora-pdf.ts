import type PDFDocument from "pdfkit";
import { AXORA_BRAND } from "@axora24/contracts";

export function axoraPdfFont(document: PDFKit.PDFDocument): void {
  document.font(require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff"));
}

export function axoraPdfHeader(document: PDFKit.PDFDocument, title: string, reference: string, companyName: string): number {
  document.image(require.resolve("@axora24/contracts/assets/axora-logo.png"), 36, 25, { fit: [68, 68] });
  axoraPdfFont(document);
  document.fontSize(17).fillColor("#1E3A8A").text(title, 119, 32, { width: 440 });
  document.fontSize(9).fillColor("#111827").text(reference, 119, Math.max(58, document.y + 4), { width: 440 });
  document.fontSize(9).text(companyName, 119, document.y + 3, { width: 440 });
  const bottom = Math.max(104, document.y + 12);
  document.moveTo(36, bottom - 5).lineTo(559, bottom - 5).strokeColor("#1E3A8A").lineWidth(2).stroke();
  document.lineWidth(0.5);
  return bottom;
}

export function axoraPdfFooter(document: PDFKit.PDFDocument, reference: string, page: number, pages: number): void {
  const bottomMargin = document.page.margins.bottom;
  document.page.margins.bottom = 0;
  axoraPdfFont(document);
  document.moveTo(36, 783).lineTo(559, 783).strokeColor("#BFC3C9").lineWidth(0.5).stroke();
  document.fontSize(7).fillColor("#4B5563").text(AXORA_BRAND.address, 36, 790, { width: 523, align: "center", lineBreak: false });
  document.text(`${AXORA_BRAND.phone} · ${AXORA_BRAND.email} · axora.cd`, 36, 801, { width: 523, align: "center", lineBreak: false });
  document.text(`${reference} · ${page} / ${pages}`, 36, 812, { width: 523, align: "center", lineBreak: false });
  document.page.margins.bottom = bottomMargin;
}

export type AxoraPdfDocument = InstanceType<typeof PDFDocument>;
