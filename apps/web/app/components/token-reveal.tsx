"use client";

import React, { useState } from "react";
import type { SmartGatewayTokenView } from "@axora24/contracts";
import { Button, Modal } from "./ui";

/** Jeton de passerelle montre une seule fois (seule son empreinte est conservee par la plateforme). */
export function TokenReveal({ issued, onClose }: { issued: SmartGatewayTokenView; onClose: () => void }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={`Jeton de la passerelle ${issued.gateway.code}`} onClose={onClose}>
      <div className="token-box">
        <p>Copiez ce jeton maintenant : il ne sera plus jamais affiché. En cas de perte, générez-en un nouveau (l'ancien cesse immédiatement de fonctionner).</p>
        <code>{issued.token}</code>
        <div>
          <Button
            variant="primary"
            onClick={() => {
              void navigator.clipboard?.writeText(issued.token).then(() => setCopied(true));
            }}
          >
            {copied ? "Copié" : "Copier le jeton"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
