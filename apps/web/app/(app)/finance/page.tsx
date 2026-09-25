"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, FileText, Landmark, Plus, Receipt, Scale, Wallet } from "lucide-react";
import { CUSTOMER_STATUS_LABEL, MATCH_LABEL, METHOD_LABEL, SUPPLIER_STATUS_LABEL, financeApi } from "../../lib/modules/finance";
import { procurementApi } from "../../lib/modules/procurement";
import { salesApi } from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import {
  Button,
  DataTable,
  DateField,
  DecimalField,
  Empty,
  Feedback,
  Form,
  Loading,
  Metric,
  Metrics,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  StatusChip,
  Tabs,
  TextField,
} from "../../components/ui";

type TabId = "receivables" | "payables" | "payments" | "treasury";
type Dialog = "invoice" | "payable" | "bank" | "tax";

export default function FinancePage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const canPayables = session.can("finance.payable.read");
  const [tab, setTab] = useState<TabId>("receivables");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const mutation = useMutation();
  const data = useResource(() =>
    Promise.all([
      financeApi.summary(),
      financeApi.invoices(),
      canPayables ? financeApi.payables() : Promise.resolve([]),
      financeApi.payments(),
      financeApi.bankAccounts(),
      financeApi.taxRates(),
    ]),
  );
  const [summary, invoices, payables, payments, accounts, taxRates] = data.data ?? [null, [], [], [], [], []];

  async function done(action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      if (open && result && typeof result === "object" && "id" in result) router.push(open(result as { id: string }));
      else await data.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Finance"
        title="Finance"
        subtitle="Facturation clients, factures fournisseurs rapprochées, paiements et trésorerie. Aucun taux fiscal n'est présumé."
        onRefresh={() => void data.reload()}
        actions={
          <>
            {session.can("finance.payable.manage") && (
              <Button onClick={() => setDialog("payable")}>
                <Receipt size={15} aria-hidden="true" /> Facture fournisseur
              </Button>
            )}
            {session.can("finance.invoice.manage") && (
              <Button variant="primary" onClick={() => setDialog("invoice")}>
                <Plus size={15} aria-hidden="true" /> Facture client
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement des données financières…" />
      ) : (
        <>
          {summary && (
            <Metrics label="Synthèse financière">
              <Metric
                icon={<FileText size={20} />}
                tone={Number(summary.receivablesOverdue) > 0 ? "red" : "blue"}
                label="Créances clients"
                value={formatMoney(summary.receivables, summary.currency)}
                detail={`dont échues : ${formatMoney(summary.receivablesOverdue, summary.currency)}`}
              />
              {summary.payables !== null && (
                <Metric
                  icon={<Scale size={20} />}
                  tone="amber"
                  label="Dettes fournisseurs validées"
                  value={formatMoney(summary.payables, summary.currency)}
                  detail={`${summary.toApprove} facture(s) à valider`}
                />
              )}
              <Metric
                icon={<Landmark size={20} />}
                tone="green"
                label="Trésorerie"
                value={formatMoney(summary.cashPosition, summary.currency)}
                detail={`Comptes en ${summary.currency}`}
              />
            </Metrics>
          )}

          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "receivables", label: "Factures clients", count: invoices.length },
              ...(canPayables ? [{ id: "payables" as const, label: "Factures fournisseurs", count: payables.length }] : []),
              { id: "payments", label: "Paiements", count: payments.length },
              { id: "treasury", label: "Trésorerie & paramètres" },
            ]}
          />

          <div className="stack">
            {tab === "receivables" && (
              <Panel title="Factures clients" subtitle="Le numéro légal est attribué à l'émission, dans l'ordre chronologique">
                <DataTable
                  rows={invoices}
                  onRowClick={(invoice) => router.push(`/finance/invoices/${invoice.id}`)}
                  empty={<Empty icon={<FileText size={22} />} title="Aucune facture client" />}
                  columns={[
                    {
                      key: "code",
                      header: "Facture",
                      render: (invoice) => (
                        <>
                          <strong>{invoice.code ?? "Brouillon"}</strong>
                          <small>
                            {invoice.customerName}
                            {invoice.contractCode ? ` · ${invoice.contractCode}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "date", header: "Émise le", render: (invoice) => formatDate(invoice.issueDate) },
                    {
                      key: "due",
                      header: "Échéance",
                      render: (invoice) => (invoice.overdue ? <StatusChip status="overdue" label={formatDate(invoice.dueDate)} /> : formatDate(invoice.dueDate)),
                    },
                    { key: "total", header: "Total TTC", align: "right", render: (invoice) => <span className="num">{formatMoney(invoice.total, invoice.currency)}</span> },
                    { key: "due-balance", header: "Reste dû", align: "right", render: (invoice) => <span className="num">{formatMoney(invoice.balanceDue, invoice.currency)}</span> },
                    { key: "status", header: "Statut", render: (invoice) => <StatusChip status={invoice.status} label={CUSTOMER_STATUS_LABEL[invoice.status]} /> },
                  ]}
                />
              </Panel>
            )}

            {tab === "payables" && (
              <Panel title="Factures fournisseurs" subtitle="Rapprochement 3-way commande ↔ réception ↔ facture ; validation par un tiers avant paiement">
                <DataTable
                  rows={payables}
                  onRowClick={(invoice) => router.push(`/finance/payables/${invoice.id}`)}
                  empty={<Empty icon={<Receipt size={22} />} title="Aucune facture fournisseur" />}
                  columns={[
                    {
                      key: "code",
                      header: "Facture",
                      render: (invoice) => (
                        <>
                          <strong>{invoice.supplierReference}</strong>
                          <small>
                            {invoice.code} · {invoice.supplierName}
                            {invoice.orderCode ? ` · ${invoice.orderCode}` : ""}
                          </small>
                        </>
                      ),
                    },
                    {
                      key: "match",
                      header: "Rapprochement",
                      render: (invoice) => (
                        <StatusChip status={invoice.matchStatus === "MATCHED" ? "done" : invoice.matchStatus === "DISCREPANCY" ? "critical" : "pending"} label={MATCH_LABEL[invoice.matchStatus]} />
                      ),
                    },
                    {
                      key: "due",
                      header: "Échéance",
                      render: (invoice) => (invoice.overdue ? <StatusChip status="overdue" label={formatDate(invoice.dueDate)} /> : formatDate(invoice.dueDate)),
                    },
                    { key: "total", header: "Total TTC", align: "right", render: (invoice) => <span className="num">{formatMoney(invoice.total, invoice.currency)}</span> },
                    { key: "balance", header: "Reste dû", align: "right", render: (invoice) => <span className="num">{formatMoney(invoice.balanceDue, invoice.currency)}</span> },
                    { key: "status", header: "Statut", render: (invoice) => <StatusChip status={invoice.status === "RECORDED" ? "pending" : invoice.status} label={SUPPLIER_STATUS_LABEL[invoice.status]} /> },
                  ]}
                />
              </Panel>
            )}

            {tab === "payments" && (
              <Panel title="Paiements" subtitle="Encaissements et décaissements — faits comptables immuables">
                <DataTable
                  rows={payments}
                  empty={<Empty icon={<Wallet size={22} />} title="Aucun paiement" />}
                  columns={[
                    { key: "date", header: "Date", render: (payment) => formatDate(payment.paidAt) },
                    {
                      key: "code",
                      header: "Pièce",
                      render: (payment) => (
                        <>
                          <strong>{payment.code}</strong>
                          <small>
                            {payment.invoiceCode ?? ""} · {payment.counterparty}
                          </small>
                        </>
                      ),
                    },
                    { key: "method", header: "Mode", render: (payment) => `${METHOD_LABEL[payment.method]}${payment.reference ? ` · ${payment.reference}` : ""}` },
                    { key: "account", header: "Compte", render: (payment) => payment.bankAccountName },
                    {
                      key: "amount",
                      header: "Montant",
                      align: "right",
                      render: (payment) => (
                        <span className={`num ${payment.direction === "IN" ? "text-success" : "text-danger"}`}>
                          {payment.direction === "IN" ? "+" : "−"}
                          {formatMoney(payment.amount, payment.currency)}
                        </span>
                      ),
                    },
                  ]}
                />
              </Panel>
            )}

            {tab === "treasury" && (
              <div className="module-grid cols-2">
                <Panel
                  title="Comptes bancaires et caisses"
                  actions={
                    session.can("finance.bank.manage") && (
                      <Button onClick={() => setDialog("bank")}>
                        <Plus size={14} aria-hidden="true" /> Compte
                      </Button>
                    )
                  }
                >
                  <DataTable
                    rows={accounts}
                    empty={<Empty icon={<Banknote size={22} />} title="Aucun compte" />}
                    columns={[
                      {
                        key: "name",
                        header: "Compte",
                        render: (account) => (
                          <>
                            <strong>{account.name}</strong>
                            <small>
                              {account.code} · {account.kind === "BANK" ? "Banque" : "Caisse"}
                              {account.iban ? ` · ${account.iban}` : ""}
                            </small>
                          </>
                        ),
                      },
                      { key: "opening", header: "Ouverture", align: "right", render: (account) => formatMoney(account.openingBalance, account.currency) },
                      { key: "balance", header: "Solde", align: "right", render: (account) => <strong className="num">{formatMoney(account.balance, account.currency)}</strong> },
                    ]}
                  />
                </Panel>
                <Panel
                  title="Taux de taxe"
                  subtitle="Paramétrés par l'entreprise : aucune règle fiscale nationale n'est présumée"
                  actions={
                    session.can("finance.settings.manage") && (
                      <Button onClick={() => setDialog("tax")}>
                        <Plus size={14} aria-hidden="true" /> Taux
                      </Button>
                    )
                  }
                >
                  <DataTable
                    rows={taxRates}
                    empty={<Empty title="Aucun taux paramétré" body="Les factures sans taux sont établies hors taxe." />}
                    columns={[
                      { key: "name", header: "Libellé", render: (rate) => rate.name },
                      { key: "rate", header: "Taux", align: "right", render: (rate) => `${rate.rate} %` },
                    ]}
                  />
                </Panel>
              </div>
            )}
          </div>
        </>
      )}

      {dialog && (
        <FinanceDialog
          dialog={dialog}
          taxOptions={taxRates.filter((rate) => rate.isActive).map((rate) => ({ value: rate.id, label: `${rate.name} (${rate.rate} %)` }))}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </>
  );
}

function FinanceDialog({
  dialog,
  taxOptions,
  saving,
  error,
  onClose,
  onDone,
}: {
  dialog: Dialog;
  taxOptions: Array<{ value: string; label: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onDone: (action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string) => Promise<void>;
}): React.ReactElement {
  const session = useSession();
  const [values, setValues] = useState<Record<string, string>>({ mode: "contract", kind: "BANK", percent: "" });
  const set = (field: string) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const value = (field: string) => values[field] ?? "";
  const decimal = (field: string) => value(field).replace(",", ".");
  const contracts = useResource(() => (dialog === "invoice" ? salesApi.contracts().catch(() => []) : Promise.resolve([])), [dialog]);
  const orders = useResource(
    () => (dialog === "payable" && session.can("procurement.order.read") ? procurementApi.orders().catch(() => []) : Promise.resolve([])),
    [dialog],
  );
  const suppliers = useResource(
    () => (dialog === "payable" && session.can("procurement.supplier.read") ? procurementApi.suppliers().catch(() => []) : Promise.resolve([])),
    [dialog],
  );
  const selectedOrder = (orders.data ?? []).find((order) => order.id === value("orderId"));

  let title = "";
  let body: React.ReactNode = null;
  switch (dialog) {
    case "invoice":
      title = "Nouvelle facture client (brouillon)";
      body = (
        <Form
          submitLabel="Créer le brouillon"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                financeApi.createInvoice(
                  value("mode") === "contract"
                    ? { contractId: value("contractId"), percent: decimal("percent"), taxRateId: value("taxRateId") || undefined }
                    : {
                        customerName: value("customerName"),
                        currency: value("currency") || "USD",
                        lines: [{ description: value("description"), quantity: decimal("quantity"), unitPrice: decimal("unitPrice"), taxRateId: value("taxRateId") || undefined }],
                      },
                ),
              "Brouillon créé : vérifiez-le puis émettez-le.",
              (result) => `/finance/invoices/${result.id}`,
            )
          }
        >
          <SelectField
            label="Type"
            value={value("mode")}
            onChange={set("mode")}
            required
            options={[
              { value: "contract", label: "Situation de travaux (pourcentage d'un contrat)" },
              { value: "free", label: "Facture libre" },
            ]}
            wide
          />
          {value("mode") === "contract" ? (
            <>
              <SelectField
                label="Contrat"
                value={value("contractId")}
                onChange={set("contractId")}
                required
                options={(contracts.data ?? []).filter((contract) => contract.status === "ACTIVE").map((contract) => ({ value: contract.id, label: `${contract.code} — ${contract.title}` }))}
              />
              <DecimalField label="Pourcentage facturé" value={value("percent")} onChange={set("percent")} required placeholder="30" hint="Le cumul facturé ne peut dépasser le montant du contrat." />
            </>
          ) : (
            <>
              <TextField label="Client" value={value("customerName")} onChange={set("customerName")} required />
              <TextField label="Devise" value={value("currency")} onChange={(next) => set("currency")(next.toUpperCase())} placeholder="USD" />
              <TextField label="Désignation" value={value("description")} onChange={set("description")} required wide />
              <DecimalField label="Quantité" value={value("quantity")} onChange={set("quantity")} required />
              <DecimalField label="Prix unitaire HT" value={value("unitPrice")} onChange={set("unitPrice")} required />
            </>
          )}
          <SelectField label="Taxe" value={value("taxRateId")} onChange={set("taxRateId")} options={taxOptions} emptyLabel="Hors taxe" />
        </Form>
      );
      break;
    case "payable":
      title = "Saisir une facture fournisseur";
      body = (
        <Form
          submitLabel="Enregistrer (rapprochement automatique)"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                financeApi.recordPayable({
                  supplierId: selectedOrder?.supplierId ?? value("supplierId"),
                  orderId: value("orderId") || undefined,
                  supplierReference: value("supplierReference"),
                  invoiceDate: value("invoiceDate"),
                  lines: selectedOrder
                    ? selectedOrder.lines
                        .filter((line) => (values[`qty-${line.id}`] ?? "") !== "")
                        .map((line) => ({
                          orderLineId: line.id,
                          description: line.description,
                          quantity: (values[`qty-${line.id}`] ?? "").replace(",", "."),
                          unitPrice: (values[`price-${line.id}`] ?? line.unitPrice).replace(",", "."),
                          taxRateId: value("taxRateId") || undefined,
                        }))
                    : [{ description: value("description"), quantity: decimal("quantity"), unitPrice: decimal("unitPrice"), taxRateId: value("taxRateId") || undefined }],
                }),
              "Facture enregistrée : elle doit être validée par une autre personne avant paiement.",
              (result) => `/finance/payables/${result.id}`,
            )
          }
        >
          <SelectField
            label="Commande rapprochée"
            value={value("orderId")}
            onChange={set("orderId")}
            options={(orders.data ?? [])
              .filter((order) => order.status !== "DRAFT" && order.status !== "CANCELLED")
              .map((order) => ({ value: order.id, label: `${order.code} — ${order.supplierName} (${formatMoney(order.total, order.currency)})` }))}
            emptyLabel="Aucune (frais hors commande)"
            wide
          />
          {!selectedOrder && (
            <SelectField
              label="Fournisseur"
              value={value("supplierId")}
              onChange={set("supplierId")}
              required
              options={(suppliers.data ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name }))}
            />
          )}
          <TextField label="N° de facture du fournisseur" value={value("supplierReference")} onChange={set("supplierReference")} required />
          <DateField label="Date de facture" value={value("invoiceDate")} onChange={set("invoiceDate")} required />
          <SelectField label="Taxe" value={value("taxRateId")} onChange={set("taxRateId")} options={taxOptions} emptyLabel="Hors taxe" />
          {selectedOrder ? (
            <div className="field wide">
              <span className="field-note">Lignes facturées (reçu à ce jour indiqué pour le contrôle)</span>
              <DataTable
                rows={selectedOrder.lines}
                empty={null}
                columns={[
                  { key: "line", header: "Ligne", render: (line) => line.description },
                  { key: "received", header: "Reçu", align: "right", render: (line) => `${line.receivedQuantity} ${line.unitCode}` },
                  { key: "price", header: "PU commande", align: "right", render: (line) => formatMoney(line.unitPrice) },
                  {
                    key: "qty",
                    header: "Qté facturée",
                    align: "right",
                    render: (line) => (
                      <input
                        className="inline-select"
                        aria-label={`Quantité facturée ${line.description}`}
                        inputMode="decimal"
                        value={values[`qty-${line.id}`] ?? ""}
                        onChange={(event) => set(`qty-${line.id}`)(event.currentTarget.value)}
                      />
                    ),
                  },
                  {
                    key: "pu",
                    header: "PU facturé",
                    align: "right",
                    render: (line) => (
                      <input
                        className="inline-select"
                        aria-label={`Prix facturé ${line.description}`}
                        inputMode="decimal"
                        placeholder={line.unitPrice}
                        value={values[`price-${line.id}`] ?? ""}
                        onChange={(event) => set(`price-${line.id}`)(event.currentTarget.value)}
                      />
                    ),
                  },
                ]}
              />
            </div>
          ) : (
            <>
              <TextField label="Désignation" value={value("description")} onChange={set("description")} required wide />
              <DecimalField label="Quantité" value={value("quantity")} onChange={set("quantity")} required />
              <DecimalField label="Prix unitaire HT" value={value("unitPrice")} onChange={set("unitPrice")} required />
            </>
          )}
        </Form>
      );
      break;
    case "bank":
      title = "Nouveau compte de trésorerie";
      body = (
        <Form
          submitLabel="Créer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                financeApi.createBankAccount({
                  code: value("code"),
                  name: value("name"),
                  kind: value("kind"),
                  currency: value("currency"),
                  iban: value("iban") || undefined,
                  openingBalance: value("openingBalance") ? decimal("openingBalance") : "0",
                }),
              "Compte créé.",
            )
          }
        >
          <TextField label="Code" value={value("code")} onChange={set("code")} required placeholder="BQ-RAWBANK" />
          <TextField label="Libellé" value={value("name")} onChange={set("name")} required />
          <SelectField label="Type" value={value("kind")} onChange={set("kind")} required options={[{ value: "BANK", label: "Banque" }, { value: "CASH", label: "Caisse" }]} />
          <TextField label="Devise" value={value("currency")} onChange={(next) => set("currency")(next.toUpperCase())} required placeholder="USD" />
          <TextField label="IBAN / RIB" value={value("iban")} onChange={set("iban")} />
          <DecimalField label="Solde d'ouverture" value={value("openingBalance")} onChange={set("openingBalance")} />
        </Form>
      );
      break;
    case "tax":
      title = "Nouveau taux de taxe";
      body = (
        <Form submitLabel="Créer" saving={saving} onSubmit={() => onDone(() => financeApi.createTaxRate({ name: value("name"), rate: decimal("rate") }), "Taux créé.")}>
          <TextField label="Libellé" value={value("name")} onChange={set("name")} required placeholder="Ex. TVA 16 %" />
          <DecimalField label="Taux (%)" value={value("rate")} onChange={set("rate")} required hint="Valeur fournie par votre conseil fiscal ; le logiciel ne présume aucun taux." />
        </Form>
      );
      break;
  }
  return (
    <Modal title={title} onClose={onClose} wide={dialog !== "tax"}>
      <Feedback error={error} />
      {body}
    </Modal>
  );
}

