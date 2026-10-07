import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setMfaStepUpHandler } from "../lib/api";
import { MfaStepUpProvider } from "./mfa-step-up-provider";

afterEach(() => {
  cleanup();
  setMfaStepUpHandler(null);
  vi.unstubAllGlobals();
});

describe("MfaStepUpProvider", () => {
  it("demande un code, élève la session puis rejoue l'action métier une seule fois", async () => {
    let protectedAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/mfa/step-up")) {
        return new Response(JSON.stringify({ verified: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      protectedAttempts += 1;
      return protectedAttempts === 1
        ? new Response(JSON.stringify({ code: "MFA_STEP_UP_REQUIRED", message: "Vérification requise" }), { status: 403, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ saved: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    function Action(): React.ReactElement {
      const [saved, setSaved] = useState(false);
      return <button onClick={() => void api.post<{ saved: boolean }>("/admin/roles", {}).then((result) => setSaved(result.saved))}>{saved ? "Enregistré" : "Enregistrer"}</button>;
    }

    render(<MfaStepUpProvider><Action /></MfaStepUpProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const code = await screen.findByRole("textbox", { name: "Code à 6 chiffres" });
    fireEvent.change(code, { target: { value: "12a34 56" } });
    expect((code as HTMLInputElement).value).toBe("123456");
    fireEvent.click(screen.getByRole("button", { name: "Vérifier et continuer" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistré" })).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(protectedAttempts).toBe(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("annule sans exécuter à nouveau l'action protégée", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "MFA_STEP_UP_REQUIRED", message: "Vérification requise" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    render(<MfaStepUpProvider><button onClick={() => void api.delete("/admin/roles/role-1").catch(() => undefined)}>Supprimer</button></MfaStepUpProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await screen.findByRole("dialog", { name: "Confirmer votre identité" });
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
