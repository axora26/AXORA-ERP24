import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";
import { estimationApi, salesApi } from "../lib/api";

vi.mock("../lib/api", () => ({
  estimationApi: { dqes: vi.fn() },
  salesApi: {
    quotes: vi.fn(),
    contracts: vi.fn(),
    quote: vi.fn(),
    createQuote: vi.fn(),
    submitQuote: vi.fn(),
    acceptQuote: vi.fn(),
    rejectQuote: vi.fn(),
    createContract: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const finalizedDqe = {
  id: "dqe-1",
  companyId: "company-1",
  opportunityId: "opp-1",
  code: "DQE-001",
  title: "DQE Campus solaire",
  currency: "USD",
  revision: 1,
  status: "FINALIZED" as const,
  subtotal: "1000.000000",
  lines: [
    {
      id: "line-1",
      position: 1,
      reference: "SOL-001",
      designation: "Panneau photovoltaïque",
      unitCode: "u",
      quantity: "10.000000",
      unitPrice: "100.000000",
      lineTotal: "1000.000000",
    },
  ],
  source: {
    studyId: "study-1",
    studyCode: "ST-001",
    studyOpportunityId: "opp-1",
    createdAt: "2026-09-22T00:00:00.000Z",
  },
  finalizedAt: "2026-09-22T00:00:00.000Z",
  createdAt: "2026-09-22T00:00:00.000Z",
};

const draftQuote = {
  id: "quote-1",
  companyId: "company-1",
  opportunityId: "opp-1",
  code: "Q-001",
  title: "Devis Campus solaire",
  currency: "USD",
  version: 1,
  status: "DRAFT" as const,
  subtotal: "1000.000000",
  submittedAt: null,
  acceptedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  createdAt: "2026-09-22T00:00:00.000Z",
  lines: finalizedDqe.lines,
  source: { dqeId: "dqe-1", dqeCode: "DQE-001" },
};

describe("SalesWorkspace", () => {
  beforeEach(() => {
    vi.mocked(estimationApi.dqes).mockResolvedValue([finalizedDqe]);
    vi.mocked(salesApi.quotes).mockResolvedValue([draftQuote]);
    vi.mocked(salesApi.contracts).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists finalized DQEs as the only eligible quote source", async () => {
    render(<SalesWorkspace />);
    expect(
      await screen.findByRole("option", { name: /DQE-001 — DQE Campus solaire/ }),
    ).toBeTruthy();
  });

  it("creates a quote from the selected finalized DQE", async () => {
    vi.mocked(salesApi.createQuote).mockResolvedValue(draftQuote);
    render(<SalesWorkspace />);
    await screen.findByLabelText(/DQE finalisé/);

    fireEvent.change(screen.getByLabelText(/DQE finalisé/), { target: { value: "dqe-1" } });
    fireEvent.change(screen.getByLabelText(/Code du devis/), { target: { value: "Q-002" } });
    fireEvent.change(screen.getByLabelText(/Titre du devis/), { target: { value: "Nouveau devis" } });
    fireEvent.click(screen.getByRole("button", { name: /Créer le devis/ }));

    await waitFor(() =>
      expect(salesApi.createQuote).toHaveBeenCalledWith({
        dqeId: "dqe-1",
        code: "Q-002",
        title: "Nouveau devis",
      }),
    );
  });

  it("opens a submitted quote and allows accept or reject with a mandatory reason", async () => {
    const submittedQuote = { ...draftQuote, status: "SUBMITTED" as const, submittedAt: "2026-09-22T00:00:00.000Z" };
    vi.mocked(salesApi.quote).mockResolvedValue(submittedQuote);
    vi.mocked(salesApi.rejectQuote).mockResolvedValue({
      ...submittedQuote,
      status: "REJECTED",
      rejectionReason: "Budget insuffisant",
    });

    render(<SalesWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Ouvrir Q-001/ }));

    expect(await screen.findByRole("button", { name: /Accepter le devis/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Motif de rejet/), { target: { value: "Budget insuffisant" } });
    fireEvent.click(screen.getByRole("button", { name: /Rejeter le devis/ }));

    await waitFor(() =>
      expect(salesApi.rejectQuote).toHaveBeenCalledWith("quote-1", "Budget insuffisant"),
    );
  });
});
