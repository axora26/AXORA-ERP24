import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EstimationWorkspace } from "./estimation-workspace";
import { crmApi, estimationApi } from "../lib/api";

vi.mock("../lib/api", () => ({
  crmApi: { opportunities: vi.fn() },
  estimationApi: {
    studies: vi.fn(),
    dqes: vi.fn(),
    study: vi.fn(),
    dqe: vi.fn(),
    createStudy: vi.fn(),
    addRequirement: vi.fn(),
    markStudyReady: vi.fn(),
    createDqe: vi.fn(),
    addDqeLine: vi.fn(),
    finalizeDqe: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const opportunity = {
  id: "opp-1",
  companyId: "company-1",
  name: "Construction centre médical",
  status: "OPEN" as const,
  amount: "125000.00",
  currency: "USD",
  stageId: "stage-1",
  stageName: "Qualification",
  accountId: null,
  accountName: null,
  contactId: null,
  sourceLeadId: null,
  expectedCloseDate: null,
  closedAt: null,
  createdAt: "2026-09-22T00:00:00.000Z",
};

const requirement = {
  id: "requirement-1",
  position: 1,
  category: "FACT" as const,
  statement: "Fondations en béton armé",
  sourceReference: "CCTP §3.1",
  createdAt: "2026-09-22T00:00:00.000Z",
};

const createdStudy = {
  id: "study-1",
  companyId: "company-1",
  opportunityId: opportunity.id,
  code: "ETU-001",
  title: "Étude centre médical",
  objective: "Établir le quantitatif initial",
  sourceReference: "DAO-01",
  status: "DRAFT" as const,
  createdAt: "2026-09-22T00:00:00.000Z",
  requirements: [],
};

const createdDqe = {
  id: "dqe-1",
  companyId: "company-1",
  opportunityId: opportunity.id,
  code: "DQE-001",
  title: "DQE centre médical",
  currency: "USD",
  status: "DRAFT" as const,
  revision: 1,
  finalizedAt: null,
  createdAt: "2026-09-22T00:00:00.000Z",
  subtotal: "0.000000",
  source: {
    studyId: "study-1",
    studyCode: "ETU-001",
    studyOpportunityId: opportunity.id,
    createdAt: "2026-09-22T00:00:00.000Z",
  },
  lines: [],
};

const line = {
  id: "line-1",
  position: 1,
  reference: "REF-001",
  designation: "Béton de propreté",
  unitCode: "m3",
  quantity: "12.500000",
  unitPrice: "95.750000",
  lineTotal: "1196.875000",
};

describe("EstimationWorkspace", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(crmApi.opportunities).mockResolvedValue([]);
    vi.mocked(estimationApi.studies).mockResolvedValue([]);
    vi.mocked(estimationApi.dqes).mockResolvedValue([]);
    vi.mocked(estimationApi.addRequirement).mockResolvedValue(requirement);
  });

  it("affiche des états vides explicites sans fabriquer de données", async () => {
    render(<EstimationWorkspace />);

    expect(await screen.findByText("Aucune étude")).toBeTruthy();
    expect(screen.getByText("Aucun DQE")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Créer l'étude" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("crée une étude liée à une opportunité réelle", async () => {
    vi.mocked(crmApi.opportunities).mockResolvedValue([opportunity]);
    vi.mocked(estimationApi.createStudy).mockResolvedValue(createdStudy);
    render(<EstimationWorkspace />);

    await screen.findByRole("option", { name: opportunity.name });
    fireEvent.change(screen.getByLabelText("Opportunité"), { target: { value: opportunity.id } });
    fireEvent.change(screen.getByLabelText("Code de l'étude"), { target: { value: "ETU-001" } });
    fireEvent.change(screen.getByLabelText("Titre de l'étude"), {
      target: { value: "Étude centre médical" },
    });
    fireEvent.change(screen.getByLabelText("Objectif"), {
      target: { value: "Établir le quantitatif initial" },
    });
    fireEvent.change(screen.getByLabelText("Référence source (optionnelle)"), {
      target: { value: "DAO-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'étude" }));

    await waitFor(() =>
      expect(estimationApi.createStudy).toHaveBeenCalledWith({
        opportunityId: opportunity.id,
        code: "ETU-001",
        title: "Étude centre médical",
        objective: "Établir le quantitatif initial",
        sourceReference: "DAO-01",
      }),
    );
  });

  it("ouvre une étude brouillon et ajoute une exigence du référentiel contrôlé", async () => {
    vi.mocked(estimationApi.studies).mockResolvedValue([createdStudy]);
    vi.mocked(estimationApi.study).mockResolvedValue(createdStudy);
    render(<EstimationWorkspace />);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir ETU-001" }));
    expect(await screen.findByRole("heading", { name: "Exigences de l'étude" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Catégorie"), { target: { value: "FACT" } });
    fireEvent.change(screen.getByLabelText("Énoncé de l'exigence"), {
      target: { value: "Fondations en béton armé" },
    });
    fireEvent.change(screen.getByLabelText("Source de l'exigence (optionnelle)"), {
      target: { value: "CCTP §3.1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter l'exigence" }));

    await waitFor(() =>
      expect(estimationApi.addRequirement).toHaveBeenCalledWith("study-1", {
        position: 1,
        category: "FACT" as const,
        statement: "Fondations en béton armé",
        sourceReference: "CCTP §3.1",
      }),
    );
  });

  it("valide et fige une étude qui contient des exigences", async () => {
    const detailedStudy = { ...createdStudy, requirements: [requirement] };
    vi.mocked(estimationApi.studies).mockResolvedValue([detailedStudy]);
    vi.mocked(estimationApi.study).mockResolvedValue(detailedStudy);
    vi.mocked(estimationApi.markStudyReady).mockResolvedValue({
      ...detailedStudy,
      status: "READY_FOR_DQE" as const,
    });
    render(<EstimationWorkspace />);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir ETU-001" }));
    fireEvent.click(await screen.findByRole("button", { name: "Valider et figer l'étude" }));

    await waitFor(() => expect(estimationApi.markStudyReady).toHaveBeenCalledWith("study-1"));
  });

  it("crée un DQE uniquement depuis une étude prête", async () => {
    const readyStudy = {
      ...createdStudy,
      status: "READY_FOR_DQE" as const,
      requirements: [requirement],
    };
    vi.mocked(estimationApi.studies).mockResolvedValue([readyStudy]);
    vi.mocked(estimationApi.study).mockResolvedValue(readyStudy);
    vi.mocked(estimationApi.createDqe).mockResolvedValue(createdDqe);
    render(<EstimationWorkspace />);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir ETU-001" }));
    expect(await screen.findByRole("heading", { name: "Créer le DQE" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Code du DQE"), { target: { value: "DQE-001" } });
    fireEvent.change(screen.getByLabelText("Titre du DQE"), {
      target: { value: "DQE centre médical" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer le DQE" }));

    await waitFor(() =>
      expect(estimationApi.createDqe).toHaveBeenCalledWith({
        studyId: "study-1",
        code: "DQE-001",
        title: "DQE centre médical",
        currency: "USD",
      }),
    );
  });

  it("ouvre un DQE brouillon et ajoute une ligne en chaînes décimales exactes", async () => {
    vi.mocked(estimationApi.dqes).mockResolvedValue([createdDqe]);
    vi.mocked(estimationApi.dqe).mockResolvedValue(createdDqe);
    vi.mocked(estimationApi.addDqeLine).mockResolvedValue(line);
    render(<EstimationWorkspace />);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir DQE-001" }));
    expect(await screen.findByRole("heading", { name: "Lignes du DQE" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Position de ligne"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Référence (optionnelle)"), {
      target: { value: "REF-001" },
    });
    fireEvent.change(screen.getByLabelText("Désignation"), {
      target: { value: "Béton de propreté" },
    });
    fireEvent.change(screen.getByLabelText("Unité"), { target: { value: "m3" } });
    fireEvent.change(screen.getByLabelText("Quantité"), { target: { value: "12.500000" } });
    fireEvent.change(screen.getByLabelText("Prix unitaire"), { target: { value: "95.750000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la ligne" }));

    await waitFor(() =>
      expect(estimationApi.addDqeLine).toHaveBeenCalledWith("dqe-1", {
        position: 1,
        reference: "REF-001",
        designation: "Béton de propreté",
        unitCode: "m3",
        quantity: "12.500000",
        unitPrice: "95.750000",
      }),
    );
  });

  it("finalise et fige un DQE qui contient au moins une ligne", async () => {
    const draftWithLine = { ...createdDqe, subtotal: "1196.875000", lines: [line] };
    vi.mocked(estimationApi.dqes).mockResolvedValue([draftWithLine]);
    vi.mocked(estimationApi.dqe).mockResolvedValue(draftWithLine);
    vi.mocked(estimationApi.finalizeDqe).mockResolvedValue({
      ...draftWithLine,
      status: "FINALIZED" as const,
      finalizedAt: "2026-09-22T01:00:00.000Z",
    });
    render(<EstimationWorkspace />);

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir DQE-001" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finaliser et figer le DQE" }));

    await waitFor(() => expect(estimationApi.finalizeDqe).toHaveBeenCalledWith("dqe-1"));
  });

  it("affiche les six décimales sans conversion IEEE-754", async () => {
    const huge = {
      ...createdDqe,
      subtotal: "999999999999999999.123456",
      lines: [{ ...line, lineTotal: "999999999999999999.123456" }],
    };
    vi.mocked(estimationApi.dqes).mockResolvedValue([huge]);
    render(<EstimationWorkspace />);

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === "TD" &&
          element.textContent?.includes("999999999999999999.123456") === true,
      ),
    ).toBeTruthy();
  });
});
