import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SecurityPage from "./page";
import { adminApi } from "../../../lib/modules/admin";

vi.mock("../../../lib/modules/admin", () => ({
  adminApi: {
    organization: vi.fn(),
    updateSecurityPolicy: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Sécurité de l'organisation", () => {
  it("affiche la politique MFA et permet de l'activer avec une confirmation explicite", async () => {
    vi.mocked(adminApi.organization).mockResolvedValue({ id: "org-1", name: "AXORA", slug: "axora", mfaRequired: false });
    vi.mocked(adminApi.updateSecurityPolicy).mockResolvedValue({ id: "org-1", name: "AXORA", slug: "axora", mfaRequired: true });

    render(<SecurityPage />);
    const toggle = await screen.findByRole("checkbox", { name: "Imposer la double authentification à tous les utilisateurs" });
    expect(screen.getByText("Une preuve récente protège les opérations critiques pendant cinq minutes dans la session courante.")).toBeTruthy();
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    expect(screen.getByText(/utilisateurs sans second facteur devront l’activer/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la politique" }));

    await waitFor(() => expect(adminApi.updateSecurityPolicy).toHaveBeenCalledWith(true));
    expect(await screen.findByText("Politique de sécurité enregistrée.")).toBeTruthy();
  });
});
