"use client";

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { api, ApiError, setMfaStepUpHandler } from "../lib/api";
import { Button, Feedback, Form, Modal, TextField } from "./ui";

/**
 * Orchestre une preuve MFA fraîche pour les mutations critiques.
 * Le code reste uniquement dans l'état mémoire du dialogue et est effacé après usage.
 */
export function MfaStepUpProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef<Array<(verified: boolean) => void>>([]);

  const finish = useCallback((verified: boolean) => {
    const resolvers = pending.current.splice(0);
    setOpen(false);
    setCode("");
    setError("");
    setSaving(false);
    for (const resolve of resolvers) resolve(verified);
  }, []);

  useEffect(() => {
    setMfaStepUpHandler(() => new Promise<boolean>((resolve) => {
      pending.current.push(resolve);
      setOpen(true);
    }));
    return () => {
      setMfaStepUpHandler(null);
      for (const resolve of pending.current.splice(0)) resolve(false);
    };
  }, []);

  async function verify(): Promise<void> {
    if (!/^\d{6}$/.test(code)) {
      setError("Saisissez les 6 chiffres affichés par votre application d’authentification.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post("/auth/mfa/step-up", { code });
      finish(true);
    } catch (caught) {
      setSaving(false);
      setError(caught instanceof ApiError ? caught.message : "La vérification a échoué. Réessayez avec un nouveau code.");
    }
  }

  return (
    <>
      {children}
      {open && (
        <Modal title="Confirmer votre identité" onClose={() => !saving && finish(false)}>
          <div className="step-up-intro">
            <ShieldCheck size={24} aria-hidden="true" />
            <div>
              <strong>Action sensible protégée</strong>
              <p>Entrez un nouveau code de votre application d’authentification. L’action reprendra une seule fois après validation.</p>
            </div>
          </div>
          <Feedback error={error} />
          <Form
            columns={1}
            saving={saving}
            submitLabel="Vérifier et continuer"
            secondary={<Button disabled={saving} onClick={() => finish(false)}>Annuler</Button>}
            onSubmit={verify}
          >
            <TextField
              label="Code à 6 chiffres"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(value) => setCode(value.replace(/[^0-9]/g, "").slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
              hint="Le code n’est jamais enregistré dans le navigateur."
            />
          </Form>
        </Modal>
      )}
    </>
  );
}
