import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NAV_GROUPS } from "../lib/navigation";
import { NavSidebar } from "./nav-sidebar";

const storedValues = new Map<string, string>();
const storage = {
  get length() { return storedValues.size; },
  clear: () => storedValues.clear(),
  getItem: (key: string) => storedValues.get(key) ?? null,
  key: (index: number) => Array.from(storedValues.keys())[index] ?? null,
  removeItem: (key: string) => { storedValues.delete(key); },
  setItem: (key: string, value: string) => { storedValues.set(key, value); },
} satisfies Storage;

beforeAll(() => Object.defineProperty(window, "localStorage", { configurable: true, value: storage }));
afterAll(() => { delete (window as { localStorage?: Storage }).localStorage; });
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("NavSidebar", () => {
  it("ouvre automatiquement le groupe de la page active malgré une préférence repliée", () => {
    window.localStorage.setItem("axora.nav.group.chantiers", "false");

    render(<NavSidebar groups={NAV_GROUPS} pathname="/projects/forecasts" onNavigate={() => undefined} />);

    const trigger = screen.getByRole("button", { name: "Chantiers" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Prévisions EAC" }).getAttribute("aria-current")).toBe("page");
  });

  it("mémorise le dépli d’un groupe sous une clé axora.nav.*", () => {
    render(<NavSidebar groups={NAV_GROUPS} pathname="/" onNavigate={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Gestion commerciale" }));

    expect(window.localStorage.getItem("axora.nav.group.gestion-commerciale")).toBe("true");
    expect(screen.getByRole("button", { name: "Gestion commerciale" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("mémorise les favoris et les rend dans un groupe Favoris en tête", () => {
    render(<NavSidebar groups={NAV_GROUPS} pathname="/" onNavigate={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Favoris" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chantiers" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajouter Projets aux favoris" }));

    expect(window.localStorage.getItem("axora.nav.favorites")).toBe('["/projects"]');
    const favoritesTrigger = screen.getByRole("button", { name: "Favoris" });
    expect(favoritesTrigger.getAttribute("aria-expanded")).toBe("true");
    const favorites = document.getElementById(favoritesTrigger.getAttribute("aria-controls") ?? "");
    expect(favorites).not.toBeNull();
    expect(within(favorites as HTMLElement).getByRole("link", { name: "Projets" })).toBeTruthy();
  });

  it("restaure les groupes dépliés et les favoris d’une session précédente", () => {
    window.localStorage.setItem("axora.nav.group.gestion-commerciale", "true");
    window.localStorage.setItem("axora.nav.favorites", '["/estimation"]');

    render(<NavSidebar groups={NAV_GROUPS} pathname="/" onNavigate={() => undefined} />);

    expect(screen.getByRole("button", { name: "Gestion commerciale" }).getAttribute("aria-expanded")).toBe("true");
    const favoritesTrigger = screen.getByRole("button", { name: "Favoris" });
    const favorites = document.getElementById(favoritesTrigger.getAttribute("aria-controls") ?? "");
    expect(within(favorites as HTMLElement).getByRole("link", { name: "Études, lots & DQE" })).toBeTruthy();
  });
});
