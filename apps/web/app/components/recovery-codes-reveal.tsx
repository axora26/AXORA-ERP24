"use client";
import React, { useState } from "react";
import { Button, Modal } from "./ui";

/** Les codes ne persistent jamais dans le navigateur. Seul l'utilisateur choisit leur export. */
export function RecoveryCodesReveal({ codes, onClose }: { codes: string[]; onClose: () => void }): React.ReactElement {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const content = `AXORA — Codes de récupération\nConservez ce fichier en lieu sûr. Chaque code ne fonctionne qu’une fois.\n\n${codes.join("\n")}\n`;
  return <Modal title="Enregistrer vos codes de récupération" onClose={onClose}><div className="token-box"><p>Ces codes sont affichés une seule fois. Conservez-les en lieu sûr pour vous connecter si vous perdez votre application d’authentification. Chaque code ne fonctionne qu’une fois.</p><ul className="recovery-code-list">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><div className="crm-row-actions"><Button variant="primary" onClick={async () => { try { await navigator.clipboard.writeText(codes.join("\n")); setNotice("Codes copiés."); setError(""); } catch { setError("La copie est indisponible. Téléchargez les codes ou copiez-les manuellement."); } }}>Copier les codes</Button><Button onClick={() => { const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "axora-codes-recuperation.txt"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Téléchargement demandé."); }}>Télécharger les codes</Button></div>{notice && <p role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}<Button onClick={onClose}>J’ai enregistré mes codes</Button></div></Modal>;
}
