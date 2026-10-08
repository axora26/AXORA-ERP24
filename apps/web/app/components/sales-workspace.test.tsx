import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";
import { ApiError, estimationApi, salesApi } from "../lib/api";

const permissions = vi.hoisted(() => new Set<string>());
const sessionScope = vi.hoisted(() => ({ activeCompanyId: "company-1" }));

vi.mock("../lib/session", () => ({
  useSession: () => ({
    activeCompanyId: sessionScope.activeCompanyId,
    can: (permission: string) => permissions.has(permission),
  }),
}));

vi.mock("../lib/api", () => ({
  estimationApi: { dqes: vi.fn() },
  salesApi: {
    quotes: vi.fn(),
    contracts: vi.fn(),
    variationContracts: vi.fn(),
    quote: vi.fn(),
    createQuote: vi.fn(),
    submitQuote: vi.fn(),
    acceptQuote: vi.fn(),
    rejectQuote: vi.fn(),
    createContract: vi.fn(),
    contractVariations: vi.fn(),
    createContractVariation: vi.fn(),
    submitContractVariation: vi.fn(),
    approveContractVariation: vi.fn(),
    rejectContractVariation: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  },
}));

const finalizedDqe = {
  id: "dqe-1",
  companyId: "company-1",
  opportunityId: "opp-1",
  code: "DQE-001",
  title: "DQE Campus solaire",
  currency: "USD",
  revision: 1,
  version: 1,
  updatedAt: "2026-09-22T00:00:00.000Z",
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

const activeContract = {
  id: "contract-1",
  companyId: "company-1",
  opportunityId: "opp-1",
  code: "C-001",
  title: "Contrat Campus solaire",
  currency: "USD",
  status: "ACTIVE" as const,
  subtotal: "1000.000000",
  createdAt: "2026-09-22T00:00:00.000Z",
  lines: finalizedDqe.lines,
  source: { quoteId: "quote-1", quoteCode: "Q-001" },
};

const submittedVariation = {
  id: "variation-1",
  companyId: "company-1",
  contractId: "contract-1",
  revisionNumber: 1,
  code: "AV-001",
  title: "Extension électrique",
  reason: "Demande complémentaire du client.",
  currency: "USD",
  amountDelta: "251.000000",
  revisedContractAmount: "1251.000000",
  status: "SUBMITTED" as const,
  version: 1,
  submittedAt: "2026-10-08T00:00:00.000Z",
  decidedAt: null,
  decisionNote: null,
  createdAt: "2026-10-08T00:00:00.000Z",
  lines: [],
};

describe("SalesWorkspace", () => {
  beforeEach(() => {
    sessionScope.activeCompanyId = "company-1";
    permissions.clear();
    [
      "estimation.dqe.read",
      "sales.quote.read",
      "sales.quote.manage",
      "sales.contract.read",
      "sales.contract.manage",
      "sales.variation.read",
      "sales.variation.manage",
      "sales.variation.approve",
    ].forEach((permission) => permissions.add(permission));
    vi.mocked(estimationApi.dqes).mockResolvedValue([finalizedDqe]);
    vi.mocked(salesApi.quotes).mockResolvedValue([draftQuote]);
    vi.mocked(salesApi.contracts).mockResolvedValue([]);
    vi.mocked(salesApi.variationContracts).mockResolvedValue([]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists finalized DQEs as the only eligible quote source", async () => {
    render(<SalesWorkspace />);
    expect(
      await screen.findByRole("option", {
        name: /DQE-001 — DQE Campus solaire/,
      }),
    ).toBeTruthy();
  });

  it("ignore une actualisation obsolète résolue après une actualisation plus récente", async () => {
    render(<SalesWorkspace />);
    await screen.findByText("Devis Campus solaire");

    let resolveOld!: (value: (typeof draftQuote)[]) => void;
    let resolveNew!: (value: (typeof draftQuote)[]) => void;
    const oldRefresh = new Promise<(typeof draftQuote)[]>((resolve) => {
      resolveOld = resolve;
    });
    const newRefresh = new Promise<(typeof draftQuote)[]>((resolve) => {
      resolveNew = resolve;
    });
    vi.mocked(salesApi.quotes)
      .mockReturnValueOnce(oldRefresh)
      .mockReturnValueOnce(newRefresh);

    const refreshButton = screen.getByRole("button", { name: "Actualiser" });
    act(() => {
      refreshButton.click();
      refreshButton.click();
    });
    await act(async () => {
      resolveNew([
        { ...draftQuote, id: "quote-new", title: "Devis le plus récent" },
      ]);
      await newRefresh;
    });
    expect(await screen.findByText("Devis le plus récent")).toBeTruthy();

    await act(async () => {
      resolveOld([{ ...draftQuote, id: "quote-old", title: "Devis obsolète" }]);
      await oldRefresh;
    });
    expect(screen.queryByText("Devis obsolète")).toBeNull();
    expect(screen.getByText("Devis le plus récent")).toBeTruthy();
  });

  it("remplace les données par un état d'erreur exclusif après un échec d'actualisation", async () => {
    render(<SalesWorkspace />);
    await screen.findByText("Devis Campus solaire");
    vi.mocked(salesApi.quotes).mockRejectedValueOnce(
      new ApiError(503, "Ventes indisponibles"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Ventes indisponibles",
    );
    expect(
      screen.queryByRole("heading", { name: "Devis, contrats & avenants" }),
    ).toBeNull();
  });

  it("permet de réessayer après un échec de chargement global", async () => {
    vi.mocked(salesApi.quotes).mockRejectedValueOnce(
      new ApiError(503, "Ventes indisponibles"),
    );
    render(<SalesWorkspace />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Ventes indisponibles",
    );
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Devis Campus solaire")).toBeTruthy();
  });

  it("réconcilie le devis sélectionné avec les données actualisées et efface le formulaire périmé", async () => {
    const acceptedQuote = { ...draftQuote, status: "ACCEPTED" as const };
    vi.mocked(salesApi.quotes).mockResolvedValue([acceptedQuote]);
    vi.mocked(salesApi.quote).mockResolvedValue(acceptedQuote);
    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );
    fireEvent.change(await screen.findByLabelText("Code du contrat"), {
      target: { value: "CONTRAT-PERIME" },
    });
    vi.mocked(salesApi.quotes).mockResolvedValueOnce([draftQuote]);
    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    expect(
      await screen.findByRole("button", { name: "Soumettre le devis" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Code du contrat")).toBeNull();
    vi.mocked(salesApi.quotes).mockResolvedValueOnce([acceptedQuote]);
    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    expect(
      ((await screen.findByLabelText("Code du contrat")) as HTMLInputElement)
        .value,
    ).toBe("");
    vi.mocked(salesApi.quotes).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: draftQuote.title }),
      ).toBeNull(),
    );
  });

  it("creates a quote from the selected finalized DQE", async () => {
    vi.mocked(salesApi.createQuote).mockResolvedValue(draftQuote);
    render(<SalesWorkspace />);
    await screen.findByLabelText(/DQE finalisé/);

    fireEvent.change(screen.getByLabelText(/DQE finalisé/), {
      target: { value: "dqe-1" },
    });
    fireEvent.change(screen.getByLabelText(/Code du devis/), {
      target: { value: "Q-002" },
    });
    fireEvent.change(screen.getByLabelText(/Titre du devis/), {
      target: { value: "Nouveau devis" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Créer le devis/ }));

    await waitFor(() =>
      expect(salesApi.createQuote).toHaveBeenCalledWith({
        dqeId: "dqe-1",
        code: "Q-002",
        title: "Nouveau devis",
      }),
    );
  });

  it("préserve un devis ouvert pendant la résolution tardive d'une création", async () => {
    const secondQuote = {
      ...draftQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    const createdQuote = {
      ...draftQuote,
      id: "quote-created",
      code: "Q-003",
      title: "Devis créé tardivement",
    };
    let resolveCreation!: (value: typeof createdQuote) => void;
    const pendingCreation = new Promise<typeof createdQuote>((resolve) => {
      resolveCreation = resolve;
    });
    vi.mocked(salesApi.quotes).mockResolvedValue([draftQuote, secondQuote]);
    vi.mocked(salesApi.quote).mockResolvedValue(secondQuote);
    vi.mocked(salesApi.createQuote).mockReturnValue(pendingCreation);

    render(<SalesWorkspace />);
    await screen.findByLabelText(/DQE finalisé/);
    fireEvent.change(screen.getByLabelText(/DQE finalisé/), {
      target: { value: "dqe-1" },
    });
    fireEvent.change(screen.getByLabelText(/Code du devis/), {
      target: { value: "Q-003" },
    });
    fireEvent.change(screen.getByLabelText(/Titre du devis/), {
      target: { value: "Devis créé tardivement" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Créer le devis/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();

    await act(async () => {
      resolveCreation(createdQuote);
      await pendingCreation;
    });
    expect(
      screen.getByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Devis créé tardivement" }),
    ).toBeNull();
  });

  it("ignore l'erreur tardive d'une création après l'ouverture d'un autre devis", async () => {
    const secondQuote = {
      ...draftQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    let rejectCreation!: (reason: Error) => void;
    const pendingCreation = new Promise<typeof draftQuote>(
      (_resolve, reject) => {
        rejectCreation = reject;
      },
    );
    vi.mocked(salesApi.quotes).mockResolvedValue([draftQuote, secondQuote]);
    vi.mocked(salesApi.quote).mockResolvedValue(secondQuote);
    vi.mocked(salesApi.createQuote).mockReturnValue(pendingCreation);

    render(<SalesWorkspace />);
    await screen.findByLabelText(/DQE finalisé/);
    fireEvent.change(screen.getByLabelText(/DQE finalisé/), {
      target: { value: "dqe-1" },
    });
    fireEvent.change(screen.getByLabelText(/Code du devis/), {
      target: { value: "Q-003" },
    });
    fireEvent.change(screen.getByLabelText(/Titre du devis/), {
      target: { value: "Devis en erreur" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Créer le devis/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();

    await act(async () => {
      rejectCreation(new ApiError(400, "Création refusée"));
      await pendingCreation.catch(() => undefined);
    });
    expect(
      screen.getByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens a submitted quote and allows accept or reject with a mandatory reason", async () => {
    const submittedQuote = {
      ...draftQuote,
      status: "SUBMITTED" as const,
      submittedAt: "2026-09-22T00:00:00.000Z",
    };
    vi.mocked(salesApi.quote).mockResolvedValue(submittedQuote);
    vi.mocked(salesApi.rejectQuote).mockResolvedValue({
      ...submittedQuote,
      status: "REJECTED",
      rejectionReason: "Budget insuffisant",
    });

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );

    expect(
      await screen.findByRole("button", { name: /Accepter le devis/ }),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Motif de rejet/), {
      target: { value: "Budget insuffisant" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Rejeter le devis/ }));

    await waitFor(() =>
      expect(salesApi.rejectQuote).toHaveBeenCalledWith(
        "quote-1",
        "Budget insuffisant",
      ),
    );
  });

  it("réinitialise le formulaire de contrat lors du changement de devis accepté", async () => {
    const acceptedQuote = {
      ...draftQuote,
      status: "ACCEPTED" as const,
      acceptedAt: "2026-10-08T00:00:00.000Z",
    };
    const secondAcceptedQuote = {
      ...acceptedQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    vi.mocked(salesApi.quotes).mockResolvedValue([
      acceptedQuote,
      secondAcceptedQuote,
    ]);
    vi.mocked(salesApi.quote).mockImplementation(async (quoteId) =>
      quoteId === acceptedQuote.id ? acceptedQuote : secondAcceptedQuote,
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );
    fireEvent.change(await screen.findByLabelText("Code du contrat"), {
      target: { value: "C-001" },
    });
    fireEvent.change(screen.getByLabelText("Titre du contrat"), {
      target: { value: "Contrat Campus solaire" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Code du contrat") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Titre du contrat") as HTMLInputElement).value,
    ).toBe("");
  });

  it("ignore le succès tardif d'un contrat après l'ouverture d'un autre devis", async () => {
    const acceptedQuote = {
      ...draftQuote,
      status: "ACCEPTED" as const,
      acceptedAt: "2026-10-08T00:00:00.000Z",
    };
    const secondQuote = {
      ...draftQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    let resolveContract!: (value: typeof activeContract) => void;
    const pendingContract = new Promise<typeof activeContract>((resolve) => {
      resolveContract = resolve;
    });
    vi.mocked(salesApi.quotes).mockResolvedValue([acceptedQuote, secondQuote]);
    vi.mocked(salesApi.quote).mockImplementation(async (quoteId) =>
      quoteId === acceptedQuote.id ? acceptedQuote : secondQuote,
    );
    vi.mocked(salesApi.createContract).mockReturnValue(pendingContract);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );
    fireEvent.change(await screen.findByLabelText("Code du contrat"), {
      target: { value: "C-001" },
    });
    fireEvent.change(screen.getByLabelText("Titre du contrat"), {
      target: { value: "Contrat Campus solaire" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer le contrat" }));
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();

    await act(async () => {
      resolveContract(activeContract);
      await pendingContract;
    });
    expect(
      screen.getByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
    expect(
      screen.queryByText("Contrat créé depuis le devis accepté."),
    ).toBeNull();
  });

  it("ignore l'échec tardif d'un contrat après l'ouverture d'un autre devis", async () => {
    const acceptedQuote = {
      ...draftQuote,
      status: "ACCEPTED" as const,
      acceptedAt: "2026-10-08T00:00:00.000Z",
    };
    const secondQuote = {
      ...draftQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    let rejectContract!: (reason: Error) => void;
    const pendingContract = new Promise<typeof activeContract>(
      (_resolve, reject) => {
        rejectContract = reject;
      },
    );
    vi.mocked(salesApi.quotes).mockResolvedValue([acceptedQuote, secondQuote]);
    vi.mocked(salesApi.quote).mockImplementation(async (quoteId) =>
      quoteId === acceptedQuote.id ? acceptedQuote : secondQuote,
    );
    vi.mocked(salesApi.createContract).mockReturnValue(pendingContract);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );
    fireEvent.change(await screen.findByLabelText("Code du contrat"), {
      target: { value: "C-001" },
    });
    fireEvent.change(screen.getByLabelText("Titre du contrat"), {
      target: { value: "Contrat Campus solaire" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer le contrat" }));
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();

    await act(async () => {
      rejectContract(new ApiError(400, "Création du contrat refusée"));
      await pendingContract.catch(() => undefined);
    });
    expect(
      screen.getByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("charge et affiche les contrats avec la seule permission contract.read", async () => {
    permissions.clear();
    permissions.add("sales.contract.read");
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);

    render(<SalesWorkspace />);

    expect(await screen.findByText("Contrat Campus solaire")).toBeTruthy();
    expect(salesApi.contracts).toHaveBeenCalledTimes(1);
    expect(salesApi.quotes).not.toHaveBeenCalled();
    expect(estimationApi.dqes).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Nouveau devis" })).toBeNull();
  });

  it("charge la projection avenants autorisée malgré des droits de lecture d'une autre entreprise", async () => {
    sessionScope.activeCompanyId = "company-2";
    vi.mocked(estimationApi.dqes).mockRejectedValueOnce(
      new ApiError(403, "DQE non autorisés"),
    );
    vi.mocked(salesApi.quotes).mockRejectedValueOnce(
      new ApiError(403, "Devis non autorisés"),
    );
    vi.mocked(salesApi.contracts).mockRejectedValueOnce(
      new ApiError(403, "Contrats non autorisés"),
    );
    vi.mocked(salesApi.variationContracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([
      submittedVariation,
    ]);
    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    expect(
      await screen.findByRole("button", { name: "Approuver l'avenant AV-001" }),
    ).toBeTruthy();
    expect(salesApi.variationContracts).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Nouveau devis" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Imprimer le contrat/ }),
    ).toBeNull();
  });

  it.each([
    "sales.variation.read",
    "sales.variation.manage",
    "sales.variation.approve",
  ])(
    "découvre les contrats et lit les avenants avec la seule permission %s",
    async (permission) => {
      permissions.clear();
      permissions.add(permission);
      vi.mocked(salesApi.variationContracts).mockResolvedValue([
        activeContract,
      ]);
      vi.mocked(salesApi.contractVariations).mockResolvedValue([
        submittedVariation,
      ]);

      render(<SalesWorkspace />);
      fireEvent.click(
        await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
      );

      expect(await screen.findByText("Extension électrique")).toBeTruthy();
      expect(salesApi.variationContracts).toHaveBeenCalledTimes(1);
      expect(salesApi.contracts).not.toHaveBeenCalled();
      expect(salesApi.quotes).not.toHaveBeenCalled();
      expect(estimationApi.dqes).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: 403, code: "MFA_STEP_UP_REQUIRED" },
    { status: 401, code: undefined },
    { status: 503, code: undefined },
  ])(
    "ne masque pas une erreur globale $status/$code derrière le fallback de permissions",
    async ({ status, code }) => {
      permissions.clear();
      permissions.add("sales.contract.read");
      permissions.add("sales.variation.read");
      vi.mocked(salesApi.contracts).mockRejectedValueOnce(
        new ApiError(status, "Intervention requise", code),
      );
      render(<SalesWorkspace />);
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Intervention requise",
      );
      expect(salesApi.variationContracts).not.toHaveBeenCalled();
    },
  );

  it("réinitialise le scope entreprise et ignore les mutations de l'entreprise quittée", async () => {
    const contractB = {
      ...activeContract,
      id: "contract-2",
      companyId: "company-2",
      code: "C-002",
      title: "Contrat entreprise B",
    };
    let resolveApproval!: (
      value: Awaited<ReturnType<typeof salesApi.approveContractVariation>>,
    ) => void;
    const pendingApproval = new Promise<
      Awaited<ReturnType<typeof salesApi.approveContractVariation>>
    >((resolve) => {
      resolveApproval = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([
      submittedVariation,
    ]);
    vi.mocked(salesApi.approveContractVariation).mockReturnValueOnce(
      pendingApproval,
    );
    const view = render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    fireEvent.change(await screen.findByLabelText("Code de l'avenant"), {
      target: { value: "DRAFT-FOR-A" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Approuver l'avenant AV-001" }),
    );
    vi.mocked(salesApi.contracts).mockResolvedValue([contractB]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([]);
    sessionScope.activeCompanyId = "company-2";
    view.rerender(<SalesWorkspace />);
    expect(
      screen.queryByRole("heading", { name: "Avenants du contrat C-001" }),
    ).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-002/ }),
    );
    expect(
      ((await screen.findByLabelText("Code de l'avenant")) as HTMLInputElement)
        .value,
    ).toBe("");
    const reads = vi.mocked(salesApi.contractVariations).mock.calls.length;
    await act(async () => {
      resolveApproval({ ...submittedVariation, status: "APPROVED" } as never);
      await pendingApproval;
    });
    expect(salesApi.contractVariations).toHaveBeenCalledTimes(reads);
    expect(screen.queryByText("Avenant approuvé.")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Avenants du contrat C-002" }),
    ).toBeTruthy();
  });

  it("retire la création d'avenants après un refus de lecture dans l'entreprise active", async () => {
    permissions.clear();
    permissions.add("sales.contract.read");
    permissions.add("sales.variation.manage");
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations).mockRejectedValueOnce(
      new ApiError(403, "Avenants non autorisés dans cette entreprise"),
    );
    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Avenants non autorisés",
    );
    expect(
      screen.queryByRole("button", { name: "Créer l'avenant" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Code de l'avenant")).toBeNull();
    expect(salesApi.createContractVariation).not.toHaveBeenCalled();
  });

  it("affiche une erreur de chargement des avenants sans faux état vide", async () => {
    permissions.clear();
    permissions.add("sales.variation.read");
    vi.mocked(salesApi.variationContracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations).mockRejectedValue(
      new ApiError(500, "Registre indisponible"),
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Registre indisponible",
    );
    expect(screen.queryByText("Aucun avenant")).toBeNull();
  });

  it("conserve une note de décision indépendante par avenant", async () => {
    const secondVariation = {
      ...submittedVariation,
      id: "variation-2",
      code: "AV-002",
      title: "Réduction plomberie",
    };
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([
      submittedVariation,
      secondVariation,
    ]);
    vi.mocked(salesApi.rejectContractVariation).mockResolvedValue({
      ...submittedVariation,
      status: "REJECTED",
      decisionNote: "Motif du premier",
    });

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    const notes = await screen.findAllByLabelText(/Note de décision/);
    fireEvent.change(notes[0]!, { target: { value: "Motif du premier" } });
    fireEvent.change(notes[1]!, { target: { value: "Motif du second" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Rejeter l'avenant AV-001" }),
    );

    await waitFor(() =>
      expect(salesApi.rejectContractVariation).toHaveBeenCalledWith(
        "contract-1",
        "variation-1",
        1,
        "Motif du premier",
      ),
    );
  });

  it("ignore une réponse tardive du contrat précédemment sélectionné", async () => {
    const contractB = {
      ...activeContract,
      id: "contract-2",
      code: "C-002",
      title: "Contrat B",
    };
    const variationA = { ...submittedVariation, title: "Avenant A" };
    const variationB = {
      ...submittedVariation,
      id: "variation-2",
      contractId: "contract-2",
      code: "AV-002",
      title: "Avenant B",
    };
    let resolveA!: (value: (typeof submittedVariation)[]) => void;
    let resolveB!: (value: (typeof submittedVariation)[]) => void;
    const requestA = new Promise<(typeof submittedVariation)[]>((resolve) => {
      resolveA = resolve;
    });
    const requestB = new Promise<(typeof submittedVariation)[]>((resolve) => {
      resolveB = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([
      activeContract,
      contractB,
    ]);
    vi.mocked(salesApi.contractVariations).mockImplementation((contractId) =>
      contractId === "contract-1" ? requestA : requestB,
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Gérer les avenants C-002/ }),
    );
    resolveB([variationB]);
    expect(await screen.findByText("Avenant B")).toBeTruthy();
    await act(async () => {
      resolveA([variationA]);
      await requestA;
    });

    expect(screen.queryByText("Avenant A")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Avenants du contrat C-002" }),
    ).toBeTruthy();
  });

  it("ignore le résultat tardif d'une décision après changement de contrat", async () => {
    const contractB = {
      ...activeContract,
      id: "contract-2",
      code: "C-002",
      title: "Contrat B",
    };
    const variationB = {
      ...submittedVariation,
      id: "variation-2",
      contractId: "contract-2",
      code: "AV-002",
      title: "Avenant B",
    };
    let resolveApproval!: (
      value: Awaited<ReturnType<typeof salesApi.approveContractVariation>>,
    ) => void;
    const pendingApproval = new Promise<
      Awaited<ReturnType<typeof salesApi.approveContractVariation>>
    >((resolve) => {
      resolveApproval = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([
      activeContract,
      contractB,
    ]);
    vi.mocked(salesApi.contractVariations).mockImplementation(
      async (contractId) =>
        contractId === "contract-1" ? [submittedVariation] : [variationB],
    );
    vi.mocked(salesApi.approveContractVariation).mockReturnValue(
      pendingApproval,
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Approuver l'avenant AV-001" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Gérer les avenants C-002/ }),
    );
    expect(await screen.findByText("Avenant B")).toBeTruthy();

    await act(async () => {
      resolveApproval({ ...submittedVariation, status: "APPROVED" });
      await pendingApproval;
    });

    expect(
      screen.getByRole("heading", { name: "Avenants du contrat C-002" }),
    ).toBeTruthy();
    expect(screen.queryByText("Avenant approuvé.")).toBeNull();
    expect(screen.getByText("Avenant B")).toBeTruthy();
  });

  it("recharge le registre après un conflit de version et annonce le remplacement", async () => {
    const refreshedVariation = {
      ...submittedVariation,
      status: "APPROVED" as const,
      version: 2,
      decisionNote: "Décision concurrente",
    };
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations)
      .mockResolvedValueOnce([submittedVariation])
      .mockResolvedValueOnce([refreshedVariation]);
    vi.mocked(salesApi.approveContractVariation).mockRejectedValue(
      new ApiError(409, "Version obsolète", "STALE_VERSION"),
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Approuver l'avenant AV-001" }),
    );

    await waitFor(() =>
      expect(salesApi.contractVariations).toHaveBeenCalledTimes(2),
    );
    expect(await screen.findByText("Décision concurrente")).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toContain(
      "données plus récentes",
    );
    expect(screen.queryByText("Version obsolète")).toBeNull();
  });

  it("n'annonce pas un remplacement lorsque le rechargement après conflit échoue", async () => {
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations)
      .mockResolvedValueOnce([submittedVariation])
      .mockRejectedValueOnce(new ApiError(503, "Rechargement impossible"));
    vi.mocked(salesApi.approveContractVariation).mockRejectedValue(
      new ApiError(409, "Version obsolète", "STALE_VERSION"),
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Approuver l'avenant AV-001" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Rechargement impossible",
    );
    expect(screen.queryByText(/données plus récentes/)).toBeNull();
  });

  it("préserve une mutation concurrente réussie pendant un rechargement 409 du même contrat", async () => {
    const secondVariation = {
      ...submittedVariation,
      id: "variation-2",
      code: "AV-002",
      title: "Réduction plomberie",
    };
    let resolveReload!: (value: (typeof submittedVariation)[]) => void;
    let rejectFirstApproval!: (reason: ApiError) => void;
    let resolveSecondApproval!: (
      value: Awaited<ReturnType<typeof salesApi.approveContractVariation>>,
    ) => void;
    const pendingReload = new Promise<(typeof submittedVariation)[]>(
      (resolve) => {
        resolveReload = resolve;
      },
    );
    const firstApproval = new Promise<
      Awaited<ReturnType<typeof salesApi.approveContractVariation>>
    >((_resolve, reject) => {
      rejectFirstApproval = reject;
    });
    const secondApproval = new Promise<
      Awaited<ReturnType<typeof salesApi.approveContractVariation>>
    >((resolve) => {
      resolveSecondApproval = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations)
      .mockResolvedValue([
        submittedVariation,
        { ...secondVariation, status: "APPROVED", version: 2 },
      ])
      .mockResolvedValueOnce([submittedVariation, secondVariation])
      .mockReturnValueOnce(pendingReload);
    vi.mocked(salesApi.approveContractVariation)
      .mockReturnValueOnce(firstApproval)
      .mockReturnValueOnce(secondApproval);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Approuver l'avenant AV-001" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Approuver l'avenant AV-002" }),
    );
    await act(async () => {
      rejectFirstApproval(
        new ApiError(409, "Version obsolète", "STALE_VERSION"),
      );
      await firstApproval.catch(() => undefined);
    });
    await waitFor(() =>
      expect(salesApi.contractVariations).toHaveBeenCalledTimes(2),
    );
    await act(async () => {
      resolveSecondApproval({ ...secondVariation, status: "APPROVED" });
      await secondApproval;
    });
    await waitFor(() =>
      expect(
        screen.getByText("Réduction plomberie").closest("tr")?.textContent,
      ).toContain("Approuvé"),
    );

    await act(async () => {
      resolveReload([submittedVariation, secondVariation]);
      await pendingReload;
    });
    expect(
      screen.getByText("Réduction plomberie").closest("tr")?.textContent,
    ).toContain("Approuvé");
  });

  it("rafraîchit les montants révisés de tous les avenants après approbation", async () => {
    const first = {
      ...submittedVariation,
      amountDelta: "100.000000",
      revisedContractAmount: "1100.000000",
    };
    const second = {
      ...submittedVariation,
      id: "variation-2",
      code: "AV-002",
      title: "Second avenant",
      amountDelta: "200.000000",
      revisedContractAmount: "1200.000000",
    };
    const approved = { ...first, status: "APPROVED" as const, version: 2 };
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations)
      .mockResolvedValueOnce([first, second])
      .mockResolvedValue([
        approved,
        { ...second, revisedContractAmount: "1300.000000" },
      ]);
    vi.mocked(salesApi.approveContractVariation).mockResolvedValueOnce(
      approved,
    );
    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Approuver l'avenant AV-001" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Second avenant").closest("tr")?.textContent,
      ).toMatch(/1\s300,00 USD/),
    );
    expect(salesApi.contractVariations).toHaveBeenCalledTimes(2);
  });

  it("ne rétrograde pas une version reçue par rechargement avant une réponse de mutation", async () => {
    const draft = {
      ...submittedVariation,
      status: "DRAFT" as const,
      version: 1,
    };
    const submitted = { ...submittedVariation, version: 2 };
    const approved = {
      ...submittedVariation,
      status: "APPROVED" as const,
      version: 3,
    };
    let resolveSubmission!: (value: typeof submitted) => void;
    const pendingSubmission = new Promise<typeof submitted>((resolve) => {
      resolveSubmission = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations)
      .mockResolvedValueOnce([draft])
      .mockResolvedValue([approved]);
    vi.mocked(salesApi.submitContractVariation).mockReturnValueOnce(
      pendingSubmission,
    );
    render(<SalesWorkspace />);
    const manage = await screen.findByRole("button", {
      name: /Gérer les avenants C-001/,
    });
    fireEvent.click(manage);
    fireEvent.click(
      await screen.findByRole("button", { name: "Soumettre l'avenant AV-001" }),
    );
    fireEvent.click(manage);
    await waitFor(() =>
      expect(
        screen.getByText("Extension électrique").closest("tr")?.textContent,
      ).toContain("Approuvé"),
    );
    await act(async () => {
      resolveSubmission(submitted);
      await pendingSubmission;
    });
    expect(
      screen.getByText("Extension électrique").closest("tr")?.textContent,
    ).toContain("Approuvé");
    expect(
      screen.queryByRole("button", { name: "Approuver l'avenant AV-001" }),
    ).toBeNull();
  });

  it("préserve une mutation réussie lorsqu'un rechargement manuel du même contrat est en cours", async () => {
    let resolveReload!: (value: (typeof submittedVariation)[]) => void;
    let resolveApproval!: (
      value: Awaited<ReturnType<typeof salesApi.approveContractVariation>>,
    ) => void;
    const pendingReload = new Promise<(typeof submittedVariation)[]>(
      (resolve) => {
        resolveReload = resolve;
      },
    );
    const pendingApproval = new Promise<
      Awaited<ReturnType<typeof salesApi.approveContractVariation>>
    >((resolve) => {
      resolveApproval = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations)
      .mockResolvedValue([
        { ...submittedVariation, status: "APPROVED", version: 2 },
      ])
      .mockResolvedValueOnce([submittedVariation])
      .mockReturnValueOnce(pendingReload);
    vi.mocked(salesApi.approveContractVariation).mockReturnValue(
      pendingApproval,
    );

    render(<SalesWorkspace />);
    const manageButton = await screen.findByRole("button", {
      name: /Gérer les avenants C-001/,
    });
    fireEvent.click(manageButton);
    fireEvent.click(
      await screen.findByRole("button", { name: "Approuver l'avenant AV-001" }),
    );
    fireEvent.click(manageButton);

    await act(async () => {
      resolveApproval({ ...submittedVariation, status: "APPROVED" });
      await pendingApproval;
    });
    await act(async () => {
      resolveReload([submittedVariation]);
      await pendingReload;
    });

    expect(
      screen.getByText("Extension électrique").closest("tr")?.textContent,
    ).toContain("Approuvé");
  });

  it("ferme le registre d'avenants lorsqu'une actualisation retire le contrat sélectionné", async () => {
    vi.mocked(salesApi.contracts)
      .mockResolvedValueOnce([activeContract])
      .mockResolvedValueOnce([]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([
      submittedVariation,
    ]);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Avenants du contrat C-001" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Actualiser" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Avenants du contrat C-001" }),
      ).toBeNull(),
    );
  });

  it("déclare toutes les cellules d'en-tête comme colonnes", async () => {
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([
      submittedVariation,
    ]);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    await screen.findByText("Extension électrique");

    expect(
      screen
        .getAllByRole("columnheader")
        .every((header) => header.getAttribute("scope") === "col"),
    ).toBe(true);
  });

  it("limite l'état d'enregistrement à l'avenant en cours", async () => {
    const secondVariation = {
      ...submittedVariation,
      id: "variation-2",
      code: "AV-002",
      title: "Réduction plomberie",
    };
    let resolveApproval!: (
      value: Awaited<ReturnType<typeof salesApi.approveContractVariation>>,
    ) => void;
    const pendingApproval = new Promise<
      Awaited<ReturnType<typeof salesApi.approveContractVariation>>
    >((resolve) => {
      resolveApproval = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.contractVariations).mockResolvedValue([
      submittedVariation,
      secondVariation,
    ]);
    vi.mocked(salesApi.approveContractVariation).mockReturnValue(
      pendingApproval,
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );
    const approveButtons = await screen.findAllByRole("button", {
      name: /Approuver l'avenant/,
    });
    fireEvent.click(approveButtons[0]!);

    await waitFor(() =>
      expect((approveButtons[0] as HTMLButtonElement).disabled).toBe(true),
    );
    expect((approveButtons[1] as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      resolveApproval({ ...submittedVariation, status: "APPROVED" });
      await pendingApproval;
    });
  });

  it("retire les actions du devis précédent dès l'ouverture d'un autre devis", async () => {
    const secondQuote = {
      ...draftQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    let resolveSecond!: (value: typeof secondQuote) => void;
    const pendingSecond = new Promise<typeof secondQuote>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(salesApi.quotes).mockResolvedValue([draftQuote, secondQuote]);
    vi.mocked(salesApi.quote).mockImplementation((quoteId) =>
      quoteId === draftQuote.id ? Promise.resolve(draftQuote) : pendingSecond,
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );
    expect(
      await screen.findByRole("button", { name: "Soumettre le devis" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));
    expect(
      screen.queryByRole("button", { name: "Soumettre le devis" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Devis Campus solaire" }),
    ).toBeNull();

    await act(async () => {
      resolveSecond(secondQuote);
      await pendingSecond;
    });
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
  });

  it("ignore l'ouverture tardive d'un devis après la sélection d'un autre devis", async () => {
    const secondQuote = {
      ...draftQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    let resolveFirst!: (value: typeof draftQuote) => void;
    let resolveSecond!: (value: typeof secondQuote) => void;
    const firstRequest = new Promise<typeof draftQuote>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRequest = new Promise<typeof secondQuote>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(salesApi.quotes).mockResolvedValue([draftQuote, secondQuote]);
    vi.mocked(salesApi.quote).mockImplementation((quoteId) =>
      quoteId === draftQuote.id ? firstRequest : secondRequest,
    );

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));

    await act(async () => {
      resolveSecond(secondQuote);
      await secondRequest;
    });
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();

    await act(async () => {
      resolveFirst(draftQuote);
      await firstRequest;
    });
    expect(
      screen.getByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Devis Campus solaire" }),
    ).toBeNull();
  });

  it("préserve le devis sélectionné pendant la résolution tardive d'une mutation précédente", async () => {
    const secondQuote = {
      ...draftQuote,
      id: "quote-2",
      code: "Q-002",
      title: "Devis Centre logistique",
    };
    const submittedFirstQuote = {
      ...draftQuote,
      status: "SUBMITTED" as const,
      submittedAt: "2026-10-08T00:00:00.000Z",
    };
    let resolveSubmission!: (value: typeof submittedFirstQuote) => void;
    const pendingSubmission = new Promise<typeof submittedFirstQuote>(
      (resolve) => {
        resolveSubmission = resolve;
      },
    );
    vi.mocked(salesApi.quotes).mockResolvedValue([draftQuote, secondQuote]);
    vi.mocked(salesApi.quote).mockImplementation(async (quoteId) =>
      quoteId === draftQuote.id ? draftQuote : secondQuote,
    );
    vi.mocked(salesApi.submitQuote).mockReturnValue(pendingSubmission);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Soumettre le devis" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Ouvrir Q-002/ }));
    expect(
      await screen.findByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();

    await act(async () => {
      resolveSubmission(submittedFirstQuote);
      await pendingSubmission;
    });
    expect(
      screen.getByRole("heading", { name: "Devis Centre logistique" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Devis Campus solaire" }),
    ).toBeNull();
  });

  it("masque toutes les mutations à un lecteur de devis", async () => {
    permissions.clear();
    permissions.add("sales.quote.read");
    const submittedQuote = {
      ...draftQuote,
      status: "SUBMITTED" as const,
      submittedAt: "2026-09-22T00:00:00.000Z",
    };
    vi.mocked(salesApi.quote).mockResolvedValue(submittedQuote);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );

    expect(await screen.findByText(/Source DQE/)).toBeTruthy();
    expect(estimationApi.dqes).not.toHaveBeenCalled();
    expect(salesApi.contracts).not.toHaveBeenCalled();
    expect(screen.getByText("Statut contrat non disponible")).toBeTruthy();
    expect(screen.queryByText("Sans contrat")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Accepter le devis/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Rejeter le devis/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Créer le contrat/ }),
    ).toBeNull();
  });

  it("ne propose pas un contrat sans droit de lire l'état contractuel", async () => {
    permissions.clear();
    permissions.add("sales.quote.read");
    permissions.add("sales.contract.manage");
    const acceptedQuote = {
      ...draftQuote,
      status: "ACCEPTED" as const,
      acceptedAt: "2026-09-22T00:00:00.000Z",
    };
    vi.mocked(salesApi.quote).mockResolvedValue(acceptedQuote);

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Ouvrir Q-001/ }),
    );

    expect(await screen.findByText(/Source DQE/)).toBeTruthy();
    expect(salesApi.contracts).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Créer le contrat/ }),
    ).toBeNull();
  });

  it("déduplique la création déjà reçue par un rechargement concurrent", async () => {
    const created = { ...submittedVariation, status: "DRAFT" as const };
    let resolveCreation!: (value: typeof created) => void;
    const pendingCreation = new Promise<typeof created>((resolve) => {
      resolveCreation = resolve;
    });
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.createContractVariation).mockReturnValueOnce(
      pendingCreation,
    );
    render(<SalesWorkspace />);
    const manage = await screen.findByRole("button", {
      name: /Gérer les avenants C-001/,
    });
    fireEvent.click(manage);
    const code = await screen.findByLabelText("Code de l'avenant");
    fireEvent.change(code, { target: { value: "AV-001" } });
    fireEvent.change(screen.getByLabelText("Titre de l'avenant"), {
      target: { value: "Extension électrique" },
    });
    fireEvent.change(screen.getByLabelText("Motif de l'avenant"), {
      target: { value: "Demande client" },
    });
    fireEvent.change(screen.getByLabelText("Désignation de la ligne"), {
      target: { value: "Tableau divisionnaire" },
    });
    fireEvent.change(screen.getByLabelText("Quantité de la ligne"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Prix unitaire de la ligne"), {
      target: { value: "251" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'avenant" }));
    await waitFor(() =>
      expect(salesApi.createContractVariation).toHaveBeenCalled(),
    );
    vi.mocked(salesApi.contractVariations).mockResolvedValue([created]);
    fireEvent.click(manage);
    await screen.findByText("Extension électrique");
    await act(async () => {
      resolveCreation(created);
      await pendingCreation;
    });
    expect(screen.getAllByText("Extension électrique")).toHaveLength(1);
    expect(salesApi.contractVariations).toHaveBeenCalledTimes(3);
  });

  it("ouvre le registre des avenants et crée une ligne structurée", async () => {
    vi.mocked(salesApi.contracts).mockResolvedValue([activeContract]);
    vi.mocked(salesApi.createContractVariation).mockResolvedValue({
      id: "variation-1",
      companyId: "company-1",
      contractId: "contract-1",
      revisionNumber: 1,
      code: "AV-001",
      title: "Extension électrique",
      reason: "Demande complémentaire du client.",
      currency: "USD",
      amountDelta: "251.000000",
      revisedContractAmount: "1251.000000",
      status: "DRAFT",
      version: 1,
      submittedAt: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: "2026-10-08T00:00:00.000Z",
      lines: [],
    });

    render(<SalesWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Gérer les avenants C-001/ }),
    );

    expect(
      await screen.findByRole("heading", { name: "Avenants du contrat C-001" }),
    ).toBeTruthy();
    expect(salesApi.contractVariations).toHaveBeenCalledWith("contract-1");

    fireEvent.change(screen.getByLabelText("Code de l'avenant"), {
      target: { value: "AV-001" },
    });
    fireEvent.change(screen.getByLabelText("Titre de l'avenant"), {
      target: { value: "Extension électrique" },
    });
    fireEvent.change(screen.getByLabelText("Motif de l'avenant"), {
      target: { value: "Demande complémentaire du client." },
    });
    fireEvent.change(screen.getByLabelText("Désignation de la ligne"), {
      target: { value: "Tableau divisionnaire complémentaire" },
    });
    fireEvent.change(screen.getByLabelText("Quantité de la ligne"), {
      target: { value: "2.000000" },
    });
    fireEvent.change(screen.getByLabelText("Prix unitaire de la ligne"), {
      target: { value: "125.500000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer l'avenant" }));

    await waitFor(() =>
      expect(salesApi.createContractVariation).toHaveBeenCalledWith(
        "contract-1",
        {
          code: "AV-001",
          title: "Extension électrique",
          reason: "Demande complémentaire du client.",
          lines: [
            {
              position: 1,
              designation: "Tableau divisionnaire complémentaire",
              unitCode: "u",
              quantity: "2.000000",
              unitPrice: "125.500000",
            },
          ],
        },
      ),
    );
  });
});
