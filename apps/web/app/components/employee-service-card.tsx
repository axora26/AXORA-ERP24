"use client";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import QRCode from "qrcode";
import { AXORA_BRAND, type EmployeeView, type EmployeeServiceCardDocument, type EmployeeServiceCardView } from "@axora24/contracts";
import { ApiError } from "../lib/api";
import { hrApi } from "../lib/modules/hr";
import { formatDate } from "../lib/format";
import { useSession } from "../lib/session";
import { DataTable, DateField, Feedback, Form, Loading, Modal, StatusChip, TextAreaField } from "./ui";
import { FileDownloadButton } from "./file-download-button";

const STATUS = { ACTIVE: "Active", EXPIRED: "Expirée", REVOKED: "Révoquée" };
export function EmployeeServiceCard({ employee, onClose, onUpdated }: { employee: EmployeeView; onClose: () => void; onUpdated: () => void }): React.ReactElement {
  const { can } = useSession();
  const manage = can("hr.card.manage");
  const [document, setDocument] = useState<EmployeeServiceCardDocument | null>(null);
  const [history, setHistory] = useState<EmployeeServiceCardView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [image, setImage] = useState("");
  const [action, setAction] = useState<"issue" | "revoke" | null>(null);
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const actionFocus = useRef<HTMLDivElement>(null);
  const issueId = useId();
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [cards, current] = await Promise.allSettled([hrApi.serviceCards(employee.id), manage ? hrApi.serviceCard(employee.id) : Promise.resolve(null)]);
    if (cards.status === "fulfilled") setHistory(cards.value); else setError(cards.reason instanceof ApiError ? cards.reason.message : "L’historique des cartes est indisponible.");
    if (current.status === "fulfilled") setDocument(current.value); else if (current.reason instanceof ApiError && current.reason.status === 404) setDocument(null); else setError(current.reason instanceof ApiError ? current.reason.message : "La carte est indisponible.");
    setLoading(false);
  }, [employee.id, manage]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (action) actionFocus.current?.focus(); }, [action]);
  useEffect(() => {
    let active = true; setImage("");
    if (document?.qrPayload && document.card.status === "ACTIVE") void QRCode.toDataURL(document.qrPayload, { margin: 4, width: 220, errorCorrectionLevel: "M" }).then(value => { if (active) setImage(value); }).catch(() => { if (active) setError("Le QR code n’a pas pu être affiché. Réessayez en rouvrant la carte."); });
    return () => { active = false; };
  }, [document]);
  async function submit(): Promise<void> {
    if (saving || !action) return;
    if (action === "issue" && expiry && expiry < new Date().toISOString().slice(0, 10)) { setError("La date d’expiration doit être aujourd’hui ou une date future."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      if (action === "issue") { setDocument(await hrApi.issueServiceCard(employee.id, expiry || undefined)); setNotice("Carte émise. Les anciennes cartes ne peuvent plus pointer."); }
      else if (document) { await hrApi.revokeServiceCard(document.card.id, reason.trim()); setDocument(null); setNotice("Carte révoquée. Son QR code ne peut plus enregistrer de pointage."); }
      setAction(null); setReason(""); setExpiry(""); await load(); onUpdated();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "L’opération a échoué. Réessayez."); }
    finally { setSaving(false); }
  }
  return <Modal title={`Carte de service — ${employee.fullName}`} onClose={() => !saving && onClose()} wide>
    <Feedback error={error} notice={notice} />
    {loading && !document && history.length === 0 ? <Loading label="Chargement des cartes…" /> : <>
      {document?.card.status === "ACTIVE" ? <><div className="service-card-preview"><div className="service-card-brand"><img src={AXORA_BRAND.logoPath} alt={AXORA_BRAND.name} width={64} height={64} /><div><strong>CARTE DE SERVICE</strong><span>{document.company.name}</span></div></div><div className="service-card-body"><div><strong>{document.employee.fullName}</strong><span>{document.employee.jobTitle}</span><span>Matricule {document.employee.code}</span><span>Émise le {formatDate(document.card.issuedAt)}</span><span>Expiration : {document.card.expiresAt ? formatDate(document.card.expiresAt) : "Non définie"}</span></div>{image ? <img src={image} alt={`QR sécurisé de la carte de ${employee.fullName}`} width={156} height={156} /> : <Loading label="Préparation du QR…" />}</div><div className="service-card-contact">{AXORA_BRAND.phone} · {AXORA_BRAND.email} · axora.cd</div></div><p className="inline-note">La borne de pointage reconnaît ce QR protégé. Après renouvellement, expiration ou révocation, cette carte ne peut plus pointer.</p></> : <p className="inline-note">{manage ? "Aucune carte active. Émettez une carte pour permettre le pointage avec un QR protégé." : "Les cartes sont émises et imprimées par un responsable habilité."}</p>}
      {manage && !action && <div className="module-form-actions"><button id={issueId} type="button" className="primary-inline-button" onClick={() => { setAction("issue"); setError(""); }}>{document?.card.status === "ACTIVE" ? "Renouveler la carte" : "Émettre une carte"}</button>{document?.card.status === "ACTIVE" && <><FileDownloadButton path={`/hr/employees/${employee.id}/service-card/export.pdf`} filename={`carte-service-${employee.code}.pdf`} onError={setError}>Imprimer la carte / PDF</FileDownloadButton><button type="button" className="secondary-button" onClick={() => { setAction("revoke"); setError(""); }}>Révoquer la carte</button></>}</div>}
      {action && <div className="service-card-action" ref={actionFocus} tabIndex={-1}><h3>{action === "issue" ? "Émission de la carte" : "Révocation de la carte"}</h3><p className="inline-note">{action === "issue" ? "L’émission remplace toutes les cartes précédentes de ce salarié. Elles ne pourront plus pointer." : "La révocation bloque immédiatement le QR de cette carte. Le salarié pourra recevoir une nouvelle carte."}</p><Form columns={1} saving={saving} submitLabel={action === "issue" ? "Confirmer l’émission" : "Confirmer la révocation"} secondary={<button type="button" className="secondary-button" disabled={saving} onClick={() => { setAction(null); window.requestAnimationFrame(() => window.document.getElementById(issueId)?.focus()); }}>Annuler</button>} onSubmit={() => void submit()}>{action === "issue" ? <DateField label="Expiration de la carte" value={expiry} onChange={setExpiry} hint="Facultatif. La date limite sera indiquée sur la carte." /> : <TextAreaField label="Motif de la révocation" value={reason} onChange={setReason} required minLength={2} maxLength={500} />}</Form></div>}
      <h3>Historique des cartes</h3><DataTable rows={history} empty={<p className="panel-note">Aucune carte émise.</p>} caption="Historique des cartes de service" columns={[{ key: "date", header: "Émission", render: card => formatDate(card.issuedAt) }, { key: "expiry", header: "Expiration", render: card => card.expiresAt ? formatDate(card.expiresAt) : "Non définie" }, { key: "status", header: "État", render: card => <StatusChip status={card.status === "ACTIVE" ? "active" : card.status === "EXPIRED" ? "warning" : "cancelled"} label={STATUS[card.status]} /> }]} />
    </>}
  </Modal>;
}
