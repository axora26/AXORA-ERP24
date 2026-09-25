"use client";

import React, { useState } from "react";
import type { PortalInvitationIssued } from "@axora24/contracts";
import { Button, Modal } from "./ui";
import { formatDateTime } from "../lib/format";

/** Lien d'activation montre une seule fois (le jeton est dans le fragment d'URL : jamais envoye aux serveurs ni aux journaux). */
export function InvitationReveal({ issued, onClose }: { issued: PortalInvitationIssued; onClose: () => void }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const link = `${typeof window === "undefined" ? "" : window.location.origin}${issued.activationPath}`;
  return (
    <Modal title={`Invitation de ${issued.principal.fullName}`} onClose={onClose}>
      <div className="token-box">
        <p>
          Transmettez ce lien à {issued.principal.email} par un canal sûr. Il est à usage unique, valable jusqu&apos;au {formatDateTime(issued.expiresAt)}, et ne sera plus jamais affiché.
        </p>
        <code>{link}</code>
        <div>
          <Button variant="primary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
            {copied ? "Copié" : "Copier le lien"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
