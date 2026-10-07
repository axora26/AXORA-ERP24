import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "./ui";

afterEach(cleanup);

describe("DataTable", () => {
  it("un bouton dans une ligne cliquable garde sa propre action (pas de navigation parasite)", () => {
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    render(
      <DataTable
        rows={[{ id: "a", label: "Alarme A" }]}
        empty={null}
        onRowClick={onRowClick}
        columns={[
          { key: "label", header: "Libellé", render: (row) => row.label },
          { key: "action", header: "", render: () => <button onClick={onAction}>Acquitter</button> },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Acquitter" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Alarme A"));
    expect(onRowClick).toHaveBeenCalledWith({ id: "a", label: "Alarme A" });
  });

  it("expose l’action de ligne avec un vrai bouton plutôt qu’une ligne pseudo-interactive", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        rows={[{ id: "a", label: "Alarme A" }]}
        empty={null}
        onRowClick={onRowClick}
        rowActionLabel={(row) => `Ouvrir ${row.label}`}
        columns={[{ key: "label", header: "Libellé", render: (row) => row.label }]}
      />,
    );
    const row = screen.getByText("Alarme A").closest("tr");
    expect(row?.getAttribute("tabindex")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir Alarme A" }));
    expect(onRowClick).toHaveBeenCalledWith({ id: "a", label: "Alarme A" });
  });
});
