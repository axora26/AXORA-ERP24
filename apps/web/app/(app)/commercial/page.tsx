"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Calculator,
  FileInput,
  FileText,
  PackageCheck,
  Receipt,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  UsersRound,
  Warehouse,
} from "lucide-react";
import { useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { DataUnavailable, Loading } from "../../components/ui";
import { loadCommercialData, type CommercialData } from "./data";

interface JourneyAction {
  href: string;
  label: string;
  permission: string | string[];
  primary?: boolean;
}

interface Journey {
  title: string;
  summary: string;
  flow: string;
  icon: React.ReactNode;
  actions: JourneyAction[];
  signal: string;
}

export default function CommercialPage(): React.ReactElement {
  const session = useSession();
  const can = session.can;
  const permissionFingerprint = [
    "estimation.dqe.read",
    "sales.quote.read",
    "sales.contract.read",
    "procurement.request.read",
    "procurement.order.read",
    "procurement.supplier.read",
    "inventory.item.read",
    "finance.invoice.read",
    "finance.payable.read",
  ].map((permission) => can(permission) ? "1" : "0").join("");

  const resource = useResource<CommercialData>(
    () => loadCommercialData(can),
    [permissionFingerprint],
  );

  if (resource.error && !resource.data && !resource.loading) {
    return <DataUnavailable title="Gestion commerciale" error={resource.error} onRetry={() => void resource.reload()} />;
  }
  if (resource.loading && !resource.data) return <Loading label="Chargement de la gestion commerciale…" />;

  const data = resource.data ?? {
    dqes: [], quotes: [], contracts: [], requests: [], orders: [], suppliers: [], items: [], warehouses: [], invoices: [], payables: [],
  };
  const activeOrders = data.orders.filter((order) => ["ISSUED", "PARTIALLY_RECEIVED"].includes(order.status)).length;
  const clientInvoicesToProcess = data.invoices.filter((invoice) => ["DRAFT", "ISSUED", "PARTIALLY_PAID"].includes(invoice.status)).length;
  const supplierInvoicesToProcess = data.payables.filter((invoice) => ["RECORDED", "APPROVED", "PARTIALLY_PAID"].includes(invoice.status)).length;
  const stockAlerts = data.items.filter((item) => item.belowMinimum).length;

  const journeys: Journey[] = [
    {
      title: "Vendre",
      summary: "Du prospect au contrat, avec un chiffrage traçable et des documents figés.",
      flow: "Prospect → Étude → DQE → Devis → Contrat",
      icon: <TrendingUp size={22} aria-hidden="true" />,
      signal: `${data.dqes.length} DQE · ${data.quotes.length} devis · ${data.contracts.length} contrat${data.contracts.length === 1 ? "" : "s"}`,
      actions: [
        { href: "/estimation", label: "Créer et structurer un DQE", permission: "estimation.dqe.read", primary: true },
        { href: "/sales", label: "Gérer devis et contrats", permission: ["sales.quote.read", "sales.contract.read"] },
        { href: "/crm", label: "Ouvrir le pipeline CRM", permission: "crm.account.read" },
      ],
    },
    {
      title: "Acheter",
      summary: "Demander, consulter, commander et réceptionner sans rompre la traçabilité projet.",
      flow: "Demande → Validation → Offre → Commande → Réception",
      icon: <ShoppingCart size={22} aria-hidden="true" />,
      signal: `${activeOrders} commande${activeOrders === 1 ? "" : "s"} en cours · ${data.suppliers.filter((supplier) => supplier.isActive).length} fournisseur${data.suppliers.filter((supplier) => supplier.isActive).length === 1 ? "" : "s"} actif${data.suppliers.filter((supplier) => supplier.isActive).length === 1 ? "" : "s"}`,
      actions: [
        { href: "/procurement", label: "Ouvrir les achats", permission: "procurement.request.read", primary: true },
        { href: "/procurement", label: "Suivre commandes et réceptions", permission: "procurement.order.read" },
        { href: "/procurement", label: "Gérer les fournisseurs", permission: "procurement.supplier.read" },
      ],
    },
    {
      title: "Facturer",
      summary: "Émettre directement, facturer un contrat, encaisser et traiter les avoirs.",
      flow: "Brouillon → Émission → Encaissement → Avoir",
      icon: <Receipt size={22} aria-hidden="true" />,
      signal: `${clientInvoicesToProcess} facture${clientInvoicesToProcess === 1 ? "" : "s"} client à traiter · ${supplierInvoicesToProcess} fournisseur`,
      actions: [
        { href: "/finance", label: "Créer une facture directe", permission: "finance.invoice.read", primary: true },
        { href: "/finance", label: "Suivre règlements et relances", permission: "finance.invoice.read" },
        { href: "/finance", label: "Traiter les factures fournisseurs", permission: "finance.payable.read" },
        { href: "/finance?tab=credits", label: "Gérer les avoirs", permission: "finance.credit.read" },
      ],
    },
    {
      title: "Gérer le stock",
      summary: "Piloter articles, magasins, réservations, mouvements, transferts et inventaires.",
      flow: "Réception → Stock → Réservation → Sortie → Inventaire",
      icon: <Boxes size={22} aria-hidden="true" />,
      signal: `${stockAlerts} article${stockAlerts === 1 ? "" : "s"} sous seuil · ${data.warehouses.filter((warehouse) => warehouse.isActive).length} magasin${data.warehouses.filter((warehouse) => warehouse.isActive).length === 1 ? "" : "s"}`,
      actions: [
        { href: "/inventory", label: "Piloter articles et magasins", permission: "inventory.item.read", primary: true },
        { href: "/inventory/reservations", label: "Réserver pour un chantier", permission: "inventory.item.read" },
        { href: "/inventory", label: "Transférer ou inventorier", permission: "inventory.movement.read" },
      ],
    },
  ];

  return (
    <>
      <section className="commercial-hero">
        <div className="commercial-hero-copy">
          <p className="commercial-context">Ventes · achats · facturation · stock</p>
          <h1>Gestion commerciale</h1>
          <p>Un poste de pilotage unique pour transformer une opportunité en chiffre d’affaires, sécuriser les achats et tenir les stocks sans ressaisie.</p>
        </div>
        <div className="commercial-hero-actions">
          <button className="commercial-refresh" type="button" onClick={() => void resource.reload()}>
            <RefreshCw size={16} aria-hidden="true" /> Actualiser
          </button>
          {can("estimation.dqe.manage") && (
            <Link className="commercial-primary" href="/estimation">
              <Calculator size={17} aria-hidden="true" /> Nouveau chiffrage
            </Link>
          )}
        </div>
      </section>

      <section className="commercial-pulse" aria-label="Situation commerciale">
        <div><span>Études</span><strong>{data.dqes.length} DQE</strong><small>{data.dqes.filter((dqe) => dqe.status === "DRAFT").length} en préparation</small></div>
        <div><span>Ventes</span><strong>{data.quotes.length} devis</strong><small>{data.quotes.filter((quote) => quote.status === "ACCEPTED").length} accepté(s)</small></div>
        <div><span>Approvisionnement</span><strong>{activeOrders} commande{activeOrders === 1 ? "" : "s"} en cours</strong><small>{data.requests.filter((request) => request.status === "SUBMITTED").length} à valider</small></div>
        <div><span>Stock</span><strong>{stockAlerts} article{stockAlerts === 1 ? "" : "s"} sous seuil</strong><small>{data.items.length} article(s) référencé(s)</small></div>
        <div><span>Facturation</span><strong>{clientInvoicesToProcess} facture{clientInvoicesToProcess === 1 ? "" : "s"} client à traiter</strong><small>{supplierInvoicesToProcess} fournisseur à traiter</small></div>
      </section>

      <section className="commercial-journeys" aria-label="Chaînes commerciales">
        {journeys.map((journey, index) => {
          const actions = journey.actions.filter((action) => Array.isArray(action.permission) ? action.permission.some(can) : can(action.permission));
          if (actions.length === 0) return null;
          return (
            <article className="commercial-journey" key={journey.title}>
              <div className="commercial-journey-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
              <div className="commercial-journey-main">
                <div className="commercial-journey-title"><span>{journey.icon}</span><h2>{journey.title}</h2></div>
                <p>{journey.summary}</p>
                <div className="commercial-flow">{journey.flow}</div>
                <strong className="commercial-signal">{journey.signal}</strong>
              </div>
              <div className="commercial-journey-actions">
                {actions.map((action) => (
                  <Link className={action.primary ? "primary" : ""} href={action.href} key={`${journey.title}-${action.label}`}>
                    <span>{action.label}</span><ArrowRight size={15} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section className="commercial-reference" aria-labelledby="commercial-reference-title">
        <div>
          <h2 id="commercial-reference-title">Référentiels et opérations</h2>
          <p>Accès direct aux données qui alimentent les documents commerciaux et les mouvements physiques.</p>
        </div>
        <nav aria-label="Référentiels commerciaux">
          {can("crm.account.read") && <Link href="/crm"><UsersRound size={17} aria-hidden="true" /><span>Clients & prospects</span></Link>}
          {can("estimation.dqe.read") && <Link href="/estimation"><FileText size={17} aria-hidden="true" /><span>Bibliothèque d’ouvrages</span></Link>}
          {can("procurement.supplier.read") && <Link href="/procurement"><FileInput size={17} aria-hidden="true" /><span>Fournisseurs & offres</span></Link>}
          {can("inventory.item.read") && <Link href="/inventory"><Warehouse size={17} aria-hidden="true" /><span>Articles & magasins</span></Link>}
          {can("procurement.order.read") && <Link href="/procurement"><PackageCheck size={17} aria-hidden="true" /><span>Réceptions & retours</span></Link>}
          {(can("finance.invoice.read") || can("finance.payable.read") || can("finance.credit.read")) && <Link href="/finance"><Receipt size={17} aria-hidden="true" /><span>Factures & règlements</span></Link>}
        </nav>
      </section>
    </>
  );
}
