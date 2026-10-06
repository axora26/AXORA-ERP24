import { PrintableDocument, type PrintColumn } from "./printable-document.js";

export type DocumentSampleKind =
  | "QUOTE"
  | "CUSTOMER_INVOICE"
  | "PROGRESS_INVOICE"
  | "CUSTOMER_CREDIT_NOTE"
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "SUPPLIER_RETURN"
  | "SUPPLIER_CREDIT_NOTE"
  | "STOCK_ISSUE"
  | "MONTHLY_ATTENDANCE"
  | "WEEKLY_TIMESHEET"
  | "PAYSLIP"
  | "SITE_DAILY_REPORT"
  | "WORKS_ACCEPTANCE";

export interface SampleFinancialLine { description: string; quantity: number; unit: string; unitPrice: number }
export interface SampleFinancial {
  currency: "USD" | "CDF";
  lines: SampleFinancialLine[];
  subtotal: number;
  tax: number;
  deductions: number;
  total: number;
  taxLabel?: string;
  deductionsLabel?: string;
}
export interface DocumentSample {
  kind: DocumentSampleKind;
  filename: string;
  title: string;
  reference: string;
  use: string;
  financial?: SampleFinancial;
}

const issuer = {
  name: "AXORA GROUP",
  address: "945, Boulevard du 30 Juin, Gombe, Kinshasa, République démocratique du Congo",
  details: ["Tél. +243 810 364 612 · infos@axora.cd · axora.cd", "RCCM / Id. Nat. / NIF / Banque : [à renseigner]"],
};
const customer = { name: "CLIENT DÉMONSTRATION SARL", address: "Kinshasa, République démocratique du Congo", details: ["Identifiants légaux : [à renseigner]"] };
const supplier = { name: "FOURNISSEUR DÉMONSTRATION SARL", address: "Kinshasa, République démocratique du Congo", details: ["Identifiants légaux : [à renseigner]"] };
const worker = { name: "KABILA Jean — MAT-DEMO-0042", address: "Ouvrier / salarié de démonstration", details: ["Identifiants administratifs : [à renseigner]"] };
const site = { name: "CHANTIER IMMEUBLE DÉMONSTRATION", address: "Gombe, Kinshasa, République démocratique du Congo", details: ["Destination interne — AXORA Démo Construction SARL"] };
const demoNotice = "DÉMONSTRATION — données fictives. Ce document illustre la mise en page AXORA ERP24 et ne constitue ni une pièce comptable ni un justificatif légal.";

/** Destinataire métier explicite : aucun document ne dépend d'un client par défaut. */
export function recipientForSampleKind(kind: DocumentSampleKind): typeof customer {
  const recipients: Record<DocumentSampleKind, typeof customer> = {
    QUOTE: customer,
    CUSTOMER_INVOICE: customer,
    PROGRESS_INVOICE: customer,
    CUSTOMER_CREDIT_NOTE: customer,
    PURCHASE_ORDER: supplier,
    GOODS_RECEIPT: supplier,
    SUPPLIER_RETURN: supplier,
    SUPPLIER_CREDIT_NOTE: supplier,
    STOCK_ISSUE: site,
    MONTHLY_ATTENDANCE: worker,
    WEEKLY_TIMESHEET: worker,
    PAYSLIP: worker,
    SITE_DAILY_REPORT: customer,
    WORKS_ACCEPTANCE: customer,
  };
  return recipients[kind];
}

function financial(currency: "USD" | "CDF", lines: SampleFinancialLine[], tax: number, deductions = 0, taxLabel = "Taxe paramétrée", deductionsLabel = "Retenues / déductions"): SampleFinancial {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return { currency, lines, subtotal, tax, deductions, total: subtotal + tax - deductions, taxLabel, deductionsLabel };
}

const worksLines: SampleFinancialLine[] = [
  { description: "Installation et sécurisation du chantier", quantity: 1, unit: "forfait", unitPrice: 2_500 },
  { description: "Maçonnerie en blocs, fourniture et pose", quantity: 120, unit: "m²", unitPrice: 28 },
  { description: "Réseau électrique basse tension", quantity: 1, unit: "forfait", unitPrice: 4_140 },
];
const materialLines: SampleFinancialLine[] = [
  { description: "Ciment gris 50 kg", quantity: 80, unit: "sac", unitPrice: 13.5 },
  { description: "Barre d'acier HA12", quantity: 120, unit: "barre", unitPrice: 11.25 },
];

export const DOCUMENT_SAMPLES: readonly DocumentSample[] = [
  { kind: "QUOTE", filename: "01-devis.pdf", title: "DEVIS", reference: "DEV-DEMO-2026-001", use: "Proposition commerciale chiffrée pour un chantier.", financial: financial("USD", worksLines, 0, 0, "Taxe paramétrée : non appliquée") },
  { kind: "CUSTOMER_INVOICE", filename: "02-facture-client.pdf", title: "FACTURE CLIENT", reference: "FAC-DEMO-2026-001", use: "Facturation d'une prestation achevée.", financial: financial("USD", worksLines.slice(0, 2), 0, 0, "Taxe paramétrée : non appliquée") },
  { kind: "PROGRESS_INVOICE", filename: "03-situation-travaux.pdf", title: "SITUATION DE TRAVAUX", reference: "SIT-DEMO-2026-003", use: "Facturation d'avancement avec retenue et récupération d'avance.", financial: financial("USD", [{ description: "Travaux cumulés valorisés à la situation n° 3", quantity: 1, unit: "forfait", unitPrice: 28_000 }], 0, 2_800, "Taxe paramétrée : non appliquée", "Retenue + récupération d'avance") },
  { kind: "CUSTOMER_CREDIT_NOTE", filename: "04-avoir-client.pdf", title: "AVOIR CLIENT", reference: "AVC-DEMO-2026-001", use: "Correction partielle d'une facture client.", financial: financial("USD", [{ description: "Correction quantité facturée — maçonnerie", quantity: 10, unit: "m²", unitPrice: 28 }], 0) },
  { kind: "PURCHASE_ORDER", filename: "05-bon-commande-fournisseur.pdf", title: "BON DE COMMANDE FOURNISSEUR", reference: "BC-DEMO-2026-014", use: "Commande de matériaux auprès d'un fournisseur.", financial: financial("USD", materialLines, 0) },
  { kind: "GOODS_RECEIPT", filename: "06-bon-reception.pdf", title: "BON DE RÉCEPTION", reference: "BR-DEMO-2026-014", use: "Constat de réception physique d'une commande fournisseur." },
  { kind: "SUPPLIER_RETURN", filename: "07-bon-retour-fournisseur.pdf", title: "BON DE RETOUR FOURNISSEUR", reference: "RET-DEMO-2026-004", use: "Retour physique de matériaux non conformes." },
  { kind: "SUPPLIER_CREDIT_NOTE", filename: "08-avoir-fournisseur.pdf", title: "AVOIR FOURNISSEUR", reference: "AVF-DEMO-2026-004", use: "Valorisation financière d'un retour fournisseur.", financial: financial("USD", [{ description: "Ciment gris 50 kg retourné", quantity: 5, unit: "sac", unitPrice: 13.5 }], 0) },
  { kind: "STOCK_ISSUE", filename: "09-bon-sortie-stock.pdf", title: "BON DE SORTIE DE STOCK", reference: "BS-DEMO-2026-021", use: "Transfert de matériaux du dépôt vers un chantier." },
  { kind: "MONTHLY_ATTENDANCE", filename: "10-fiche-presence-mensuelle.pdf", title: "FICHE DE PRÉSENCE MENSUELLE", reference: "PRES-DEMO-2026-09", use: "Synthèse journalière de présence d'un ouvrier sur chantier." },
  { kind: "WEEKLY_TIMESHEET", filename: "11-feuille-temps-hebdomadaire.pdf", title: "FEUILLE DE TEMPS HEBDOMADAIRE", reference: "TEMPS-DEMO-S40", use: "Imputation hebdomadaire des heures par chantier et activité." },
  { kind: "PAYSLIP", filename: "12-bulletin-paie.pdf", title: "BULLETIN DE PAIE", reference: "PAIE-DEMO-2026-09", use: "Bulletin illustratif avec rubriques administrées et cumuls.", financial: financial("CDF", [{ description: "Salaire de base", quantity: 1, unit: "mois", unitPrice: 1_200_000 }, { description: "Prime de transport paramétrée", quantity: 22, unit: "jour", unitPrice: 8_000 }], 0, 126_000, "Charges employeur : hors net", "Retenues paramétrées") },
  { kind: "SITE_DAILY_REPORT", filename: "13-rapport-journalier-chantier.pdf", title: "RAPPORT JOURNALIER DE CHANTIER", reference: "RJ-DEMO-2026-10-06", use: "Compte rendu quotidien des travaux, effectifs et incidents." },
  { kind: "WORKS_ACCEPTANCE", filename: "14-pv-reception-travaux.pdf", title: "PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX", reference: "PV-DEMO-2026-001", use: "Réception contradictoire des travaux et suivi des réserves." },
] as const;

function amount(value: number, currency: "USD" | "CDF"): string {
  const decimals = currency === "CDF" ? 0 : 2;
  const [integer = "0", fraction] = value.toFixed(decimals).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped}${fraction ? `,${fraction}` : ""} ${currency}`;
}

function baseDocument(sample: DocumentSample, recipient = customer): PrintableDocument {
  const document = new PrintableDocument(sample.title, sample.reference, "AXORA GROUP", true);
  document.parties(issuer, recipient);
  document.metaGrid([
    ["Date d'émission", "06/10/2026"],
    ["Référence", sample.reference],
    ["Chantier", "Immeuble Démonstration — Gombe"],
    ["Statut", "DÉMONSTRATION"],
  ]);
  document.notice(demoNotice, "warning");
  return document;
}

function renderFinancial(document: PrintableDocument, data: SampleFinancial): void {
  const columns: PrintColumn[] = [
    { label: "Désignation", width: 263 },
    { label: "Qté", width: 55, align: "right" },
    { label: "Unité", width: 60 },
    { label: "P.U.", width: 70, align: "right" },
    { label: "Montant", width: 75, align: "right" },
  ];
  document.table(columns, data.lines.map((line) => [line.description, String(line.quantity), line.unit, amount(line.unitPrice, data.currency), amount(line.quantity * line.unitPrice, data.currency)]));
  const totals: Array<readonly [string, string, boolean?]> = [["Sous-total", amount(data.subtotal, data.currency)]];
  if (data.tax !== 0) totals.push([data.taxLabel ?? "Taxe paramétrée", amount(data.tax, data.currency)]);
  else totals.push([data.taxLabel ?? "Taxe paramétrée", amount(0, data.currency)]);
  if (data.deductions !== 0) totals.push([data.deductionsLabel ?? "Déductions", `- ${amount(data.deductions, data.currency)}`]);
  totals.push(["Net / total", amount(data.total, data.currency), true]);
  document.totals(totals);
}

function renderMovement(document: PrintableDocument, returnFlow = false): void {
  document.section(returnFlow ? "Articles retournés" : "Articles et quantités");
  document.table(
    [{ label: "Article", width: 233 }, { label: "Commandé", width: 85, align: "right" }, { label: returnFlow ? "Retourné" : "Reçu / sorti", width: 95, align: "right" }, { label: "Observation", width: 110 }],
    returnFlow
      ? [["Ciment gris 50 kg", "80 sacs", "5 sacs", "Emballages endommagés"], ["Barre d'acier HA12", "120 barres", "0", "Conforme"]]
      : [["Ciment gris 50 kg", "80 sacs", "80 sacs", "Conforme"], ["Barre d'acier HA12", "120 barres", "118 barres", "Écart : 2 barres"]],
  );
  document.signatures(["Magasinier", returnFlow ? "Transporteur / fournisseur" : "Contrôleur chantier"]);
}

function renderAttendance(document: PrintableDocument): void {
  document.metaGrid([["Ouvrier", "KABILA Jean — MAT-DEMO-0042"], ["Période", "Septembre 2026"], ["Chantier", "Immeuble Démonstration"], ["État", "À valider"]]);
  document.table(
    [{ label: "Jour", width: 60 }, { label: "Entrée", width: 62 }, { label: "Sortie", width: 62 }, { label: "Heures", width: 64, align: "right" }, { label: "Chantier", width: 165 }, { label: "État / absence", width: 110 }],
    [
      ["01/09", "07:28", "16:34", "8,0 h", "Immeuble Démonstration", "Présent"],
      ["02/09", "07:31", "16:40", "8,0 h", "Immeuble Démonstration", "Présent"],
      ["03/09", "—", "—", "0,0 h", "Immeuble Démonstration", "Absence justifiée"],
      ["04/09", "07:25", "15:32", "7,0 h", "Immeuble Démonstration", "Présent"],
      ["05/09", "—", "—", "0,0 h", "Immeuble Démonstration", "Intempérie"],
      ["07/09", "07:30", "16:36", "8,0 h", "Immeuble Démonstration", "Présent"],
      ["08/09", "07:27", "17:35", "9,0 h", "Immeuble Démonstration", "Présent · HS à valider"],
    ],
  );
  document.notice("Les statuts et heures de cet exemple sont fictifs. La validation réelle doit être effectuée par une personne distincte du saisisseur.", "info");
  document.signatures(["Chef de chantier", "Contrôleur RH", "Ouvrier"]);
}

function renderTimesheet(document: PrintableDocument): void {
  document.metaGrid([["Ouvrier", "KABILA Jean — MAT-DEMO-0042"], ["Semaine", "S40 · 28/09 au 04/10/2026"]]);
  document.table(
    [{ label: "Jour", width: 74 }, { label: "Chantier", width: 169 }, { label: "Activité / WBS", width: 190 }, { label: "Heures", width: 90, align: "right" }],
    [["Lundi", "Immeuble Démonstration", "ELEC-01 · Cheminements", "8,0 h"], ["Mardi", "Immeuble Démonstration", "ELEC-02 · Câblage", "8,0 h"], ["Mercredi", "Immeuble Démonstration", "ELEC-02 · Câblage", "9,0 h"], ["Jeudi", "Immeuble Démonstration", "ELEC-03 · Tableaux", "8,0 h"], ["Vendredi", "Immeuble Démonstration", "ELEC-03 · Tableaux", "7,0 h"]],
  );
  document.totals([["Total semaine", "40,0 h", true]]);
  document.signatures(["Salarié", "Responsable projet", "Validateur tiers"]);
}

function renderPayslip(document: PrintableDocument, data: SampleFinancial): void {
  document.metaGrid([["Salarié", "KABILA Jean — MAT-DEMO-0042"], ["Période", "Septembre 2026"], ["Devise", "CDF"], ["Politique", "Paramètres de démonstration — non légaux"]]);
  document.notice("Les rubriques et montants sont purement fictifs. Aucun taux CNSS, IPR, INPP, ONEM ou autre taux légal n'est présumé par cet exemple.", "danger");
  document.section("Gains");
  renderFinancial(document, data);
  document.section("Retenues et cumuls", 120);
  document.table([{ label: "Rubrique", width: 288 }, { label: "Base / quantité", width: 120 }, { label: "Montant", width: 115, align: "right" }], [["Retenue paramétrée — démonstration", "Base administrée", "126 000 CDF"], ["Cumul brut démonstration", "Janv. – sept.", "10 540 000 CDF"], ["Cumul net démonstration", "Janv. – sept.", "9 406 000 CDF"]]);
  document.signatures(["Employeur", "Salarié"]);
}

function renderDailyReport(document: PrintableDocument): void {
  document.metaGrid([["Date", "06/10/2026"], ["Météo", "Matin : couvert · Après-midi : pluie"], ["Effectif AXORA", "18 personnes"], ["Sous-traitants", "7 personnes"]]);
  document.section("Travaux réalisés");
  document.table([{ label: "Zone", width: 125 }, { label: "Activité", width: 258 }, { label: "Avancement du jour", width: 140 }], [["Niveau 1", "Pose des chemins de câbles", "24 mètres"], ["Niveau 2", "Maçonnerie des cloisons", "38 m²"], ["Toiture", "Préparation des supports", "Zone B terminée"]]);
  document.section("Sécurité, qualité et incidents");
  document.notice("Aucun accident déclaré dans cet exemple. Une réserve qualité fictive a été ouverte sur la zone B et doit être contrôlée avant fermeture.", "warning");
  document.signatures(["Chef de chantier", "Conducteur de travaux", "Contrôle QHSE"]);
}

function renderAcceptance(document: PrintableDocument): void {
  document.paragraph("Les parties procèdent contradictoirement à la réception des travaux du chantier Immeuble Démonstration. Après visite, la réception est prononcée avec les réserves fictives ci-dessous.");
  document.section("Réserves");
  document.table([{ label: "N°", width: 42 }, { label: "Localisation", width: 125 }, { label: "Réserve", width: 246 }, { label: "Échéance", width: 110 }], [["R-01", "Niveau 1", "Reprise de finition sur une gaine technique", "15/10/2026"], ["R-02", "Hall", "Réglage d'une porte vitrée", "12/10/2026"]]);
  document.notice("Délai de levée et portée juridique à confirmer dans le contrat réel. Les données de cette démonstration sont fictives.", "info");
  document.signatures(["Maître d'ouvrage", "Entreprise AXORA", "Maîtrise d'œuvre"]);
}

export async function generateDocumentSample(sample: DocumentSample): Promise<Buffer> {
  const document = baseDocument(sample, recipientForSampleKind(sample.kind));

  switch (sample.kind) {
    case "QUOTE":
    case "CUSTOMER_INVOICE":
    case "CUSTOMER_CREDIT_NOTE":
    case "PURCHASE_ORDER":
    case "SUPPLIER_CREDIT_NOTE":
      renderFinancial(document, sample.financial!);
      document.notice(sample.kind === "QUOTE" ? "Validité de l'offre : durée à renseigner dans le dossier réel." : "Référence contractuelle et conditions de règlement : [à renseigner].", "info");
      document.signatures(sample.kind === "PURCHASE_ORDER" ? ["Achats AXORA", "Fournisseur"] : ["AXORA GROUP", "Client"]);
      break;
    case "PROGRESS_INVOICE":
      document.metaGrid([["Avancement antérieur", "40 %"], ["Avancement cumulé", "55 %"], ["Retenue de garantie", "Paramètre de démonstration"], ["Récupération d'avance", "Paramètre de démonstration"]]);
      renderFinancial(document, sample.financial!);
      document.signatures(["Entreprise", "Contrôle travaux", "Client"]);
      break;
    case "GOODS_RECEIPT": renderMovement(document); break;
    case "SUPPLIER_RETURN": renderMovement(document, true); break;
    case "STOCK_ISSUE":
      document.metaGrid([["Dépôt source", "Dépôt central — DEMO"], ["Destination", "Chantier Immeuble Démonstration"]]);
      document.table([{ label: "Article", width: 263 }, { label: "Quantité", width: 90, align: "right" }, { label: "Unité", width: 70 }, { label: "WBS / destination", width: 100 }], [["Ciment gris 50 kg", "25", "sacs", "GROS-01"], ["Barre d'acier HA12", "40", "barres", "GROS-02"]]);
      document.signatures(["Magasinier", "Transporteur", "Réception chantier"]);
      break;
    case "MONTHLY_ATTENDANCE": renderAttendance(document); break;
    case "WEEKLY_TIMESHEET": renderTimesheet(document); break;
    case "PAYSLIP": renderPayslip(document, sample.financial!); break;
    case "SITE_DAILY_REPORT": renderDailyReport(document); break;
    case "WORKS_ACCEPTANCE": renderAcceptance(document); break;
  }

  return document.finish();
}
