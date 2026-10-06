import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal, Tabs, TextField } from "./ui";

afterEach(cleanup);

describe("Keyboard interactions", () => {
  it("keeps modal focus inside, restores the trigger and leaves background controls inert while open", () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Ouvrir</button>{open && <Modal title="Informations" onClose={() => setOpen(false)}><button>Dernière action</button><button tabIndex={-1}>Option sélectionnée aux flèches</button></Modal>}</>;
    }
    render(<Example/>);
    const trigger = screen.getByRole("button", { name: "Ouvrir" });
    trigger.focus(); fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "Fermer" });
    const last = screen.getByRole("button", { name: "Dernière action" });
    expect(document.activeElement).toBe(close);
    expect(trigger.inert).toBe(true);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger.inert).not.toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("does not reset focus on a modal rerender and invokes the latest close callback", () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const { rerender } = render(<Modal title="Modifier" onClose={firstClose}><input aria-label="Nom" defaultValue="AXORA"/></Modal>);
    const input = screen.getByRole("textbox", { name: "Nom" });
    input.focus();
    rerender(<Modal title="Modifier" onClose={latestClose}><input aria-label="Nom" defaultValue="AXORA"/></Modal>);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it("uses one Tab stop for tabs and switches with arrows, Home and End", () => {
    function Example() {
      const [active, setActive] = useState("clients");
      return <Tabs active={active} onChange={setActive} tabs={[{ id: "clients", label: "Clients" }, { id: "fournisseurs", label: "Fournisseurs" }, { id: "contacts", label: "Contacts" }]}/>;
    }
    render(<Example/>);
    const clients = screen.getByRole("tab", { name: "Clients" });
    const suppliers = screen.getByRole("tab", { name: "Fournisseurs" });
    const contacts = screen.getByRole("tab", { name: "Contacts" });
    expect(clients.tabIndex).toBe(0);
    expect(suppliers.tabIndex).toBe(-1);
    fireEvent.keyDown(clients, { key: "ArrowRight" });
    expect(document.activeElement).toBe(suppliers);
    expect(suppliers.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(suppliers, { key: "End" });
    expect(document.activeElement).toBe(contacts);
    fireEvent.keyDown(contacts, { key: "Home" });
    expect(document.activeElement).toBe(clients);
    fireEvent.keyDown(clients, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(contacts);
  });

  it("associates field hints and inline errors with the input", () => {
    render(<TextField label="Nom" value="" onChange={() => undefined} hint="Nom légal complet" error="Le nom est requis"/>);
    const input = screen.getByRole("textbox", { name: "Nom", description: "Nom légal complet Le nom est requis" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
  });
});
