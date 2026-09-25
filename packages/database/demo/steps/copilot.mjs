import { createClient } from "../client.mjs";
import { WORKFLOW_DEMO } from "./workflow.mjs";

/**
 * COPILOTE DEMO : le role DAF recoit `ai.copilot.use` (sans aucun droit de
 * lecture supplementaire) ; quelques questions reelles de la direction et de
 * la DAF produisent des preuves d'inference, dont un refus RBAC trace.
 */
export const copilotStep = {
  name: "Copilote IA (questions réelles, preuves RBAC)",
  async isDone(api) {
    return (await api.get("/copilot/sessions")).length > 0;
  },
  async run(api) {
    const roles = await api.get("/admin/roles");
    const daf = roles.find((role) => role.name === "Contrôle de gestion (DAF)");
    if (daf && !daf.permissions.includes("ai.copilot.use")) {
      await api.put(`/admin/roles/${daf.id}/permissions`, { permissions: [...daf.permissions, "ai.copilot.use"] });
    }

    const requests = await api.get("/procurement/requests");
    const pending = requests.find((request) => request.status === "SUBMITTED");
    const first = await api.post("/copilot/ask", { question: "Fais-moi une synthèse de la situation" });
    await api.post("/copilot/ask", { question: "Quelles factures clients sont impayées ?", sessionId: first.sessionId });
    if (pending) await api.post("/copilot/ask", { question: `Où en est ${pending.code} ?`, sessionId: first.sessionId });
    await api.post("/copilot/ask", { question: "Y a-t-il des alarmes techniques actives ?" });

    if (daf) {
      const client = createClient(api.baseUrl);
      await client.post("/auth/login", { email: WORKFLOW_DEMO.daf.email, password: WORKFLOW_DEMO.daf.password });
      const own = await client.post("/copilot/ask", { question: "Quelles demandes d'achat attendent une décision ?" });
      const denied = await client.post("/copilot/ask", { question: "Quelles non-conformités QHSE sont ouvertes ?", sessionId: own.sessionId });
      const refused = denied.evidence.permissionChecks.filter((check) => !check.granted).length;
      console.log(`    copilote DAF : ${own.evidence.sources.length} source(s) citée(s) ; QHSE refusé (${refused} contrôle(s) refusé(s), ${denied.evidence.sources.length} source)`);
    }
  },
};
