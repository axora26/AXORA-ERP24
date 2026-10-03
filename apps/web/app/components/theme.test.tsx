import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, ThemeSelector, useTheme } from "./theme";
import { api } from "../lib/api";

vi.mock("../lib/api", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

function ContextActions() {
  const { loadPreference, error } = useTheme();
  return <><button onClick={() => void loadPreference()}>Charger les préférences</button>{error && <p role="alert">{error}</p>}</>;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn(() => media) });
  vi.mocked(api.get).mockResolvedValue({ theme: "dark" });
  vi.mocked(api.patch).mockImplementation(async (_path, body) => body);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("display preferences", () => {
  it("follows system preference changes when the system option is selected", async () => {
    render(<ThemeProvider><ThemeSelector/></ThemeProvider>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    media.matches = true;
    const apply = media.addEventListener.mock.calls.at(-1)?.[1] as (() => void) | undefined;
    apply?.();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("synchronizes the authenticated user's saved theme from the server", async () => {
    render(<ThemeProvider><ThemeSelector/><ContextActions/></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Charger les préférences" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(api.get).toHaveBeenCalledWith("/auth/preferences");
    expect(localStorage.getItem("axora.theme")).toBe("dark");
  });
  it("saves a new choice to the user account and browser cache", async () => {
    render(<ThemeProvider><ThemeSelector/></ThemeProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: "Thème d’affichage" }), { target: { value: "dark" } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/auth/preferences", { theme: "dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("axora.theme")).toBe("dark");
  });
  it("reports a failed account save while preserving the local display choice", async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error("network"));
    render(<ThemeProvider><ThemeSelector/><ContextActions/></ThemeProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: "Thème d’affichage" }), { target: { value: "dark" } });
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Le thème s’applique ici, mais sa sauvegarde sur votre compte a échoué. Sélectionnez-le à nouveau pour réessayer.");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
