import QRCode from "qrcode";
import { AXORA_BRAND, type EmployeeServiceCardDocument, type PayrollRunView } from "@axora24/contracts";
import { PrintableDocument } from "../common/printable-document.js";

export async function payrollSlipPdf(run: PayrollRunView, employeeId: string, companyName: string, demo = false, employeeCode?: string): Promise<Buffer> {
  const line = run.lines.find(item => item.employeeId === employeeId);
  if (!line) throw new Error("Payroll employee not found");
  const historical = line.attendanceHours === undefined;
  const reference = `PAIE-${run.period}${employeeCode ? `-${employeeCode}` : ""}`;
  const doc = new PrintableDocument("Fiche de paie", reference, companyName, demo);
  doc.paragraph(`Salarié : ${line.employeeName}` , 12);
  if (employeeCode) doc.paragraph(`Matricule : ${employeeCode}`);
  doc.paragraph(`Période : ${run.period} · Devise : ${run.currency}`);
  doc.paragraph(`Statut : ${run.status === "CLOSED" ? "CLÔTURÉ — calcul figé" : "BROUILLON — à vérifier avant clôture"}`);
  if (run.closedAt) doc.paragraph(`Clôture : ${run.closedAt.slice(0, 10)}`);
  doc.section("Base du calcul");
  const parameters = historical ? "Paramètres historiques" : run.policy?.version ? `Version des paramètres : ${run.policy.version}` : "Paramètres par défaut (version 0)";
  doc.paragraph(`Méthode : ${run.policy?.mode === "VALIDATED_HOURS" ? "Heures validées" : "Salaire mensuel de base"} · ${parameters}`);
  if (run.policy?.standardMonthlyHours) doc.paragraph(`Référence mensuelle : ${run.policy.standardMonthlyHours} h · Coefficient supplémentaire : ${run.policy.overtimeCoefficient ?? "Non configuré"}`);
  doc.paragraph(`Heures de présence : ${line.attendanceHours ?? "Non disponibles (historique)"} · Heures validées : ${line.validatedHours}`);
  if (run.policy?.mode === "VALIDATED_HOURS") doc.paragraph(`Heures normales : ${line.regularHours ?? "0"} · Heures supplémentaires : ${line.overtimeHours ?? "0"} · Taux horaire : ${line.hourlyRate ?? "0"} ${run.currency}`);
  doc.table([{ label: "Élément de rémunération", width: 378 }, { label: `Montant ${run.currency}`, width: 145, align: "right" }], [
    ["Salaire mensuel de référence", line.baseSalary],
    ["Rémunération calculée automatiquement", line.automaticAmount ?? line.baseSalary],
    ["Primes et retenues saisies", line.adjustments],
    ["Total de rémunération calculé", line.grossAmount],
  ]);
  if (line.adjustmentNotes) doc.paragraph(`Justification des éléments variables : ${line.adjustmentNotes}`);
  doc.paragraph(`Total calculé : ${line.grossAmount} ${run.currency}`, 13, "#1E3A8A");
  doc.section("Cotisations et net à payer");
  doc.paragraph("Les retenues légales ne sont pas configurées. Le net à payer n’est pas calculé. Cette fiche présente le calcul de rémunération et doit être complétée selon les règles applicables avant paiement.");
  const warnings = run.warnings?.filter(warning => warning.employeeId === employeeId) ?? [];
  if (warnings.length) { doc.section("Points à vérifier"); warnings.forEach(warning => doc.paragraph(warning.message)); }
  doc.paragraph("Visa du responsable : ____________________     Signature du salarié : ____________________");
  return doc.finish();
}

export async function serviceCardPdf(card: EmployeeServiceCardDocument, demo = false): Promise<Buffer> {
  const doc = new PrintableDocument("Carte de service", card.employee.code, card.company.name, demo);
  doc.paragraph("Format des cartes : 85,6 × 54 mm. Imprimer à 100 %, découper puis assembler le recto et le verso.");
  const pdf = doc.pdf;
  const qr = await QRCode.toBuffer(card.qrPayload, { type: "png", errorCorrectionLevel: "M", margin: 4, width: 600, color: { dark: "#111827", light: "#FFFFFF" } });
  const width = 242.65, height = 153.07, x = 176;
  const drawFrame = (y: number, label: string) => {
    pdf.fontSize(8).fillColor("#4B5563").text(label, x, y - 16, { width, align: "center", lineBreak: false });
    pdf.rect(x, y, width, height).lineWidth(0.6).strokeColor("#BFC3C9").stroke();
    pdf.rect(x, y, width, 8).fill("#1E3A8A");
  };
  const frontY = 205;
  drawFrame(frontY, "RECTO");
  pdf.image(require.resolve("@axora24/contracts/assets/axora-logo.png"), x + 9, frontY + 13, { fit: [51, 51] });
  pdf.fontSize(10).fillColor("#1E3A8A").text(demo ? "CARTE DE SERVICE — DÉMO" : "CARTE DE SERVICE", x + 66, frontY + 23, { width: 163, lineBreak: false });
  pdf.fontSize(7).fillColor("#111827").text(card.company.name, x + 66, frontY + 40, { width: 163, height: 19, ellipsis: true });
  pdf.fontSize(10).text(card.employee.fullName, x + 12, frontY + 71, { width: width - 24, height: 28, ellipsis: true });
  pdf.fontSize(8).text(card.employee.jobTitle, x + 12, frontY + 101, { width: width - 24, height: 21, ellipsis: true });
  pdf.fontSize(8).text(`Matricule : ${card.employee.code}`, x + 12, frontY + 125, { width: width - 24, lineBreak: false });
  const backY = 410;
  drawFrame(backY, "VERSO — QR DE POINTAGE");
  pdf.image(qr, x + 9, backY + 18, { width: 99, height: 99 });
  pdf.fontSize(7).fillColor("#111827").text(`Matricule : ${card.employee.code}`, x + 114, backY + 22, { width: 119, height: 20, ellipsis: true });
  pdf.text(`Émise le ${card.card.issuedAt.slice(0, 10)}\nExpiration : ${card.card.expiresAt?.slice(0, 10) ?? "Sans échéance"}`, x + 114, backY + 46, { width: 119, height: 34 });
  pdf.text("Carte personnelle. Présenter le QR au poste de pointage. Signaler toute perte pour révocation.", x + 114, backY + 84, { width: 119, height: 40 });
  pdf.fontSize(6.5).text(AXORA_BRAND.address, x + 7, backY + 119, { width: width - 14, height: 22, align: "center" });
  pdf.fontSize(6.5).text(`${AXORA_BRAND.phone} · ${AXORA_BRAND.email}`, x + 7, backY + 142, { width: width - 14, align: "center", lineBreak: false });
  return doc.finish();
}
