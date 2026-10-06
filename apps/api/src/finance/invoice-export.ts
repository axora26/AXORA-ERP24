import type { CustomerInvoiceView, InvoiceSignatureView } from "@axora24/contracts";
import { PrintableDocument } from "../common/printable-document.js";

/**
 * Server side invoice export used when a document must be archived or sent
 * outside the browser. Amounts are already calculated by Finance and are
 * copied verbatim into the PDF. The signature evidence is deliberately
 * labelled as AXORA's internal HMAC proof; it is not presented as a
 * qualified eIDAS signature.
 */
export async function customerInvoicePdf(
  invoice: CustomerInvoiceView,
  companyName: string,
  demo = false,
  signature?: InvoiceSignatureView,
): Promise<Buffer> {
  const reference = invoice.code ?? `Brouillon ${invoice.id}`;
  const document = new PrintableDocument("Facture client", reference, companyName, demo);
  const status = {
    DRAFT: "BROUILLON — non émise",
    ISSUED: "ÉMISE",
    PARTIALLY_PAID: "PARTIELLEMENT RÉGLÉE",
    PAID: "RÉGLÉE",
    CANCELLED: "ANNULÉE",
  }[invoice.status];

  document.paragraph(`Statut : ${status}`);
  document.paragraph(`Facturé à : ${invoice.customerName}${invoice.customerAddress ? `\n${invoice.customerAddress}` : ""}`);
  document.paragraph(
    `Date d'émission : ${invoice.issueDate?.slice(0, 10) ?? "Non émise"} · Échéance : ${invoice.dueDate?.slice(0, 10) ?? "—"} · Devise : ${invoice.currency}`,
  );
  if (invoice.contractCode || invoice.projectCode) {
    document.paragraph(`Contrat : ${invoice.contractCode ?? "—"} · Projet : ${invoice.projectCode ?? "—"}`);
  }

  document.table(
    [
      { label: "Désignation", width: 213 },
      { label: "Quantité", width: 55, align: "right" },
      { label: "Prix unitaire", width: 70, align: "right" },
      { label: "HT", width: 75, align: "right" },
      { label: "TVA", width: 55, align: "right" },
      { label: "Taux %", width: 55, align: "right" },
    ],
    invoice.lines.map((line) => [line.description, line.quantity, line.unitPrice, line.lineTotal, line.lineTax, line.taxRate]),
  );
  document.paragraph(`Total HT : ${invoice.subtotal} ${invoice.currency} · TVA : ${invoice.taxTotal} ${invoice.currency}`, 11);
  document.paragraph(`Total TTC : ${invoice.total} ${invoice.currency}`, 13, "#1E3A8A");
  document.paragraph(`Déjà réglé : ${invoice.paidAmount} ${invoice.currency} · Reste à payer : ${invoice.balanceDue} ${invoice.currency}`);
  if (invoice.credit && Number(invoice.credit.creditedAmount) > 0) {
    document.paragraph(`Avoirs émis : ${invoice.credit.creditedAmount} ${invoice.currency} · Total après avoirs : ${invoice.credit.netTotal} ${invoice.currency}`);
  }
  if (invoice.notes) document.paragraph(`Notes : ${invoice.notes}`);
  if (invoice.cancelReason) document.paragraph(`Annulation : ${invoice.cancelReason}`, 9, "#991B1B");

  if (signature?.status === "VALID") {
    document.section("Signature électronique interne AXORA");
    document.paragraph(`Empreinte SHA-256 : ${signature.documentHash}`);
    document.paragraph(`Algorithme : ${signature.algorithm} · Signée le : ${signature.signedAt.slice(0, 10)}`);
    document.paragraph("Cette preuve permet de vérifier l'intégrité de la représentation signée dans la fiche facture. Elle ne constitue pas une signature qualifiée eIDAS.", 8, "#475467");
  }

  return document.finish();
}
