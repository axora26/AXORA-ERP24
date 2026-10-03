import type { CreditNoteView } from "@axora24/contracts";
import { PrintableDocument } from "../common/printable-document.js";

export async function creditNotePdf(credit: CreditNoteView, companyName: string, demo = false): Promise<Buffer> {
  const reference = credit.code ?? `Brouillon ${credit.id}`;
  const doc = new PrintableDocument(credit.kind === "CUSTOMER" ? "Avoir client" : "Avoir fournisseur", reference, companyName, demo);
  doc.paragraph(`Statut : ${{ DRAFT: "BROUILLON — non émis", ISSUED: "ÉMIS", CANCELLED: "ANNULÉ" }[credit.status]}`);
  doc.paragraph(`Facture source : ${credit.sourceInvoiceCode ?? credit.sourceInvoiceId} · ${credit.sourceInvoiceName}`);
  doc.paragraph(`Date d’émission : ${credit.issueDate?.slice(0, 10) ?? "Non émis"} · Devise : ${credit.currency}`);
  doc.paragraph(`Motif : ${credit.reason}`);
  if (credit.cancelReason) doc.paragraph(`Annulation : ${credit.cancelReason}`, 9, "#991B1B");
  doc.table([
    { label: "Désignation", width: 213 }, { label: "Quantité", width: 55, align: "right" },
    { label: "Prix unitaire", width: 70, align: "right" }, { label: "HT", width: 75, align: "right" },
    { label: "TVA", width: 55, align: "right" }, { label: "Taux %", width: 55, align: "right" },
  ], credit.lines.map(line => [line.description, line.quantity, line.unitPrice, line.lineTotal, line.lineTax, line.taxRate]));
  doc.paragraph(`Total HT : ${credit.subtotal} ${credit.currency} · TVA : ${credit.taxTotal} ${credit.currency}`, 11);
  doc.paragraph(`Total avoir : ${credit.total} ${credit.currency}`, 13, "#1E3A8A");
  doc.section("Situation de la facture source");
  doc.paragraph(`Facture après avoirs émis : ${credit.invoice.netTotal} ${credit.currency}`);
  doc.paragraph(`Reste à payer : ${credit.invoice.balanceDue} ${credit.currency} · Remboursement dû : ${credit.invoice.refundDue} ${credit.currency}`);
  if (credit.refunds.length) {
    doc.section("Remboursements enregistrés");
    doc.table([{ label: "Référence", width: 183 }, { label: "Date", width: 95 }, { label: "Mode", width: 100 }, { label: "Montant", width: 145, align: "right" }],
      credit.refunds.map(refund => [refund.code, refund.refundedAt.slice(0, 10), refund.method, `${refund.amount} ${refund.currency}`]));
  }
  return doc.finish();
}
