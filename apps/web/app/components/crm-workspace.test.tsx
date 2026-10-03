import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmDashboardView, CrmPipelineStageView } from "@axora24/contracts";
import { CrmWorkspace } from "./crm-workspace";
import { crmApi, formatAmount } from "../lib/api";

vi.mock("../lib/session", () => { const session = { can: () => true, companies: [], activeCompanyId: "company-1" }; return { useSession: () => session }; });

vi.mock("../lib/api", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, crmApi: { dashboard: vi.fn(), stages: vi.fn(), leads: vi.fn(), opportunities: vi.fn(), createLead: vi.fn(), convertLead: vi.fn() } };
});

const stages: CrmPipelineStageView[] = [{ id: "stage-1", companyId: "company-1", name: "Qualification", position: 1, probability: 50, isWon: false, isLost: false }];
const breakdown = (currency: string, amount: string) => ({ currency, pipelineValue: amount, weightedPipelineValue: amount, wonValue: "0.00", stages: [{ stageId: "stage-1", stageName: "Qualification", position: 1, probability: 50, opportunityCount: 1, value: amount }] });
const dashboard: CrmDashboardView = {
  companyId: "company-1", currency: "MIXED", pipelineValue: null, weightedPipelineValue: null, wonValue: null,
  leads: { available: true, total: 0, open: 0, converted: 0 }, opportunities: { total: 2, open: 2, won: 0, lost: 0 },
  stages: [{ stageId: "stage-1", stageName: "Qualification", position: 1, probability: 50, opportunityCount: 2, value: null }],
  currencyBreakdown: [breakdown("EUR", "100.00"), breakdown("USD", "200.00")],
};

beforeEach(() => {
  vi.mocked(crmApi.dashboard).mockResolvedValue(dashboard);
  vi.mocked(crmApi.stages).mockResolvedValue(stages);
  vi.mocked(crmApi.leads).mockResolvedValue([]);
  vi.mocked(crmApi.opportunities).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CRM currency display", () => {
  it("displays incompatible currencies separately in summaries and pipeline stages", async () => {
    render(<CrmWorkspace/>);
    const summary = await screen.findByRole("region", { name: "Montants par devise" });
    expect(within(summary).getAllByText(formatAmount("100.00", "EUR"))).toHaveLength(2);
    expect(within(summary).getAllByText(formatAmount("200.00", "USD"))).toHaveLength(2);
    const pipeline = screen.getByRole("region", { name: "Étapes du pipeline commercial" });
    expect(within(pipeline).getByText(formatAmount("100.00", "EUR"))).toBeTruthy();
    expect(within(pipeline).getByText(formatAmount("200.00", "USD"))).toBeTruthy();
    expect(screen.getByText("Valeur du pipeline").closest("article")?.textContent).toContain("Plusieurs devises");
    expect(document.body.textContent).not.toContain("MIXED");
  });
  it("retains normal totals when the currency is shared", async () => {
    vi.mocked(crmApi.dashboard).mockResolvedValue({ ...dashboard, currency: "EUR", pipelineValue: "100.00", weightedPipelineValue: "50.00", wonValue: "0.00", currencyBreakdown: [breakdown("EUR", "100.00")] });
    render(<CrmWorkspace/>);
    await screen.findByText("Valeur du pipeline");
    expect(screen.getByText("Valeur du pipeline").closest("article")?.textContent).toContain(formatAmount("100.00", "EUR"));
    expect(screen.queryByRole("region", { name: "Montants par devise" })).toBeNull();
  });
});
