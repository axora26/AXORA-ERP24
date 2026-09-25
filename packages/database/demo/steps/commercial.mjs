/** Chaine commerciale DEMO : prospects -> opportunites -> etude -> DQE -> devis -> contrat. */

const LEADS = [
  { contactName: "Aline Mbuyi", companyName: "Clinique Saint-Luc", email: "a.mbuyi@example.test", source: "Salon BTP" },
  { contactName: "Patrick Ilunga", companyName: "Université de Lubumbashi", email: "p.ilunga@example.test", source: "Recommandation" },
  { contactName: "Sarah Kanza", companyName: "Hôtel Fleuve Congo", email: "s.kanza@example.test", source: "Site web" },
  { contactName: "Didier Tshala", companyName: "Banque Centrale Régionale", email: "d.tshala@example.test", source: "Appel d'offres" },
  { contactName: "Nadine Okito", companyName: "Résidence Les Palmiers", email: "n.okito@example.test", source: "Prospection" },
];

const CONVERSIONS = [
  { companyName: "Clinique Saint-Luc", opportunityName: "Extension bloc opératoire", amount: "1850000.00", stage: "Negociation" },
  { companyName: "Université de Lubumbashi", opportunityName: "Campus solaire 2 MWc", amount: "3200000.00", stage: "Proposition" },
  { companyName: "Hôtel Fleuve Congo", opportunityName: "Rénovation CVC et GTB", amount: "940000.00", stage: "Analyse du besoin" },
];

const DQE_LINES = [
  { reference: "GO-01", designation: "Terrassement et fondations", unitCode: "m3", quantity: "420", unitPrice: "85.00" },
  { reference: "GO-02", designation: "Béton armé structure", unitCode: "m3", quantity: "310", unitPrice: "295.00" },
  { reference: "CVC-01", designation: "Centrale de traitement d'air 12 000 m3/h", unitCode: "u", quantity: "2", unitPrice: "48500.00" },
  { reference: "ELEC-01", designation: "Tableau général basse tension", unitCode: "u", quantity: "1", unitPrice: "62000.00" },
  { reference: "FLU-01", designation: "Réseau gaz médicaux", unitCode: "ml", quantity: "850", unitPrice: "74.50" },
  { reference: "SEC-01", designation: "Système de détection incendie", unitCode: "forfait", quantity: "1", unitPrice: "38400.00" },
];

export const commercialStep = {
  name: "Commercial (CRM, Études, Devis, Contrat)",
  async isDone(api) {
    const leads = await api.get("/crm/leads");
    return leads.length > 0;
  },
  async run(api, ctx) {
    const stages = await api.get("/crm/pipeline/stages");
    const stageByName = new Map(stages.map((stage) => [stage.name, stage.id]));

    const leads = [];
    for (const lead of LEADS) leads.push(await api.post("/crm/leads", lead));

    const opportunities = [];
    for (const conversion of CONVERSIONS) {
      const lead = leads.find((candidate) => candidate.companyName === conversion.companyName);
      const opportunity = await api.post(`/crm/leads/${lead.id}/convert`, {
        opportunityName: conversion.opportunityName,
        amount: conversion.amount,
        currency: "USD",
      });
      const stageId = stageByName.get(conversion.stage);
      if (stageId) await api.patch(`/crm/opportunities/${opportunity.id}/stage`, { stageId });
      opportunities.push(opportunity);
    }

    const target = opportunities[0];
    const study = await api.post("/estimation/studies", {
      opportunityId: target.id,
      code: "ET-2026-001",
      title: "Étude — Extension bloc opératoire",
      objective: "Établir les hypothèses techniques vérifiables avant chiffrage du lot principal.",
      sourceReference: "Cahier des charges client v2",
    });
    const requirements = [
      { category: "FACT", statement: "Surface à construire : 1 250 m² sur deux niveaux.", sourceReference: "Plan masse PM-02" },
      { category: "CONSTRAINT", statement: "Maintien en exploitation des blocs existants pendant les travaux." },
      { category: "ASSUMPTION", statement: "Sol porteur à 1,80 m (hypothèse à confirmer par étude géotechnique)." },
      { category: "RISK", statement: "Délai d'importation des centrales de traitement d'air : 14 semaines." },
    ];
    for (const [index, requirement] of requirements.entries()) {
      await api.post(`/estimation/studies/${study.id}/requirements`, { position: index + 1, ...requirement });
    }
    await api.post(`/estimation/studies/${study.id}/ready`);

    const dqe = await api.post("/estimation/dqes", {
      studyId: study.id,
      code: "DQE-2026-001",
      title: "DQE — Extension bloc opératoire",
      currency: "USD",
    });
    for (const [index, line] of DQE_LINES.entries()) {
      await api.post(`/estimation/dqes/${dqe.id}/lines`, { position: index + 1, ...line });
    }
    await api.post(`/estimation/dqes/${dqe.id}/finalize`);

    const quote = await api.post("/sales/quotes", { dqeId: dqe.id, code: "DV-2026-001", title: "Offre — Extension bloc opératoire" });
    await api.post(`/sales/quotes/${quote.id}/submit`);
    await api.post(`/sales/quotes/${quote.id}/accept`);
    const contract = await api.post("/sales/contracts", {
      quoteId: quote.id,
      code: "CT-2026-001",
      title: "Contrat — Extension bloc opératoire Clinique Saint-Luc",
    });
    ctx.contractId = contract.id;
    ctx.opportunities = opportunities;
  },
};
