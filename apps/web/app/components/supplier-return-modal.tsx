"use client";

import React, { useState } from "react";
import type { PurchaseOrderView } from "@axora24/contracts";
import { newIdempotencyKey } from "../lib/modules/procurement";
import { formatMoney, formatQuantity } from "../lib/format";
import { DataTable, Empty, Feedback, Form, Modal, TextAreaField } from "./ui";

export interface SupplierReturnInput {
  idempotencyKey: string;
  reason: string;
  lines: Array<{ orderLineId: string; quantity: string }>;
}

/**
 * Saisie d'un retour physique au fournisseur. Seules les lignes ayant un reçu
 * net positif sont proposées ; la quantité est bornée côté client pour guider
 * la saisie, le serveur restant l'autorité (verrou + CHECK en base).
 */
export function SupplierReturnModal({
  order,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  order: PurchaseOrderView;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: SupplierReturnInput) => Promise<void>;
}): React.ReactElement {
  // Clé générée une fois à l'ouverture : un double clic ne crée jamais deux retours.
  const [idempotencyKey] = useState(() => newIdempotencyKey("ret"));
  const returnable = order.lines.filter((line) => Number(line.receivedQuantity) > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  const lines = returnable
    .map((line) => ({ line, quantity: (quantities[line.id] ?? "").replace(",", ".").trim() }))
    .filter((entry) => entry.quantity !== "");
  const value = lines.reduce((total, entry) => total + (Number(entry.quantity) || 0) * Number(entry.line.unitPrice), 0);
  const hasStocked = lines.some((entry) => entry.line.inventoryItemId);

  async function submit(): Promise<void> {
    for (const entry of lines) {
      const amount = Number(entry.quantity);
      if (!/^\d+(\.\d{1,3})?$/.test(entry.quantity) || amount <= 0) {
        setLocalError(`Quantité invalide pour « ${entry.line.description} ».`);
        return;
      }
      if (amount > Number(entry.line.receivedQuantity)) {
        setLocalError(`« ${entry.line.description} » : le retour dépasse le reçu net (${formatQuantity(entry.line.receivedQuantity, 3)} ${entry.line.unitCode}).`);
        return;
      }
    }
    if (lines.length === 0) {
      setLocalError("Indiquez la quantité retournée d'au moins une ligne.");
      return;
    }
    setLocalError("");
    await onSubmit({ idempotencyKey, reason: reason.trim(), lines: lines.map((entry) => ({ orderLineId: entry.line.id, quantity: entry.quantity })) });
  }

  return (
    <Modal title={`Retour fournisseur — ${order.code}`} onClose={onClose} wide>
      <Feedback error={localError || error} />
      <Form columns={1} submitLabel="Enregistrer le retour" saving={saving} onSubmit={submit}>
        <DataTable
          rows={returnable}
          empty={<Empty title="Aucune quantité reçue à retourner" />}
          columns={[
            { key: "line", header: "Désignation", render: (line) => line.description },
            { key: "received", header: "Reçu net", align: "right", render: (line) => `${formatQuantity(line.receivedQuantity, 3)} ${line.unitCode}` },
            {
              key: "qty",
              header: "Quantité retournée",
              align: "right",
              render: (line) => (
                <input
                  className="inline-select"
                  aria-label={`Quantité retournée ${line.description}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={quantities[line.id] ?? ""}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setQuantities((current) => ({ ...current, [line.id]: next }));
                  }}
                />
              ),
            },
          ]}
        />
        <TextAreaField
          label="Motif du retour"
          value={reason}
          onChange={setReason}
          required
          hint="Non-conformité, avarie, surplus ou erreur de livraison. Le motif est conservé dans la pièce et le journal d'audit."
        />
        <p className="inline-note" aria-live="polite">
          Valeur retournée au prix de commande : <strong>{formatMoney(value.toFixed(2), order.currency)}</strong>
          {hasStocked && " · les articles stockés sortent du dépôt de réception au coût moyen ; le stock réservé reste protégé."}
        </p>
      </Form>
    </Modal>
  );
}
