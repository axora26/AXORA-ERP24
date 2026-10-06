import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), replace: vi.fn() }));
vi.mock("../lib/api", () => ({
  api: { get: mocks.get, post: mocks.post },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import { RegisterOrganization } from "./register-organization";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("RegisterOrganization — politique d'inscription", () => {
  it("affiche le formulaire quand la création d'espaces est ouverte", async () => {
    mocks.get.mockResolvedValue({ mode: "open", open: true });
    render(<RegisterOrganization />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/auth/registration"));
    expect(screen.getByRole("button", { name: /Créer mon organisation/ })).toBeTruthy();
  });

  it("remplace le formulaire par un message quand l'instance est fermée", async () => {
    mocks.get.mockResolvedValue({ mode: "first-organization", open: false });
    render(<RegisterOrganization />);
    expect(await screen.findByText("Création d’espaces fermée")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Créer mon organisation/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Retour à la connexion" })).toBeTruthy();
  });

  it("garde le formulaire si la politique est illisible : le serveur reste l'autorité", async () => {
    mocks.get.mockRejectedValue(new Error("réseau"));
    render(<RegisterOrganization />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Créer mon organisation/ })).toBeTruthy();
  });
});
