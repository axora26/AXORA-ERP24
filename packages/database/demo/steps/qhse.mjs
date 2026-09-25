import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";
import { scenePng } from "../media.mjs";

const DAY_MS = 86_400_000;

/**
 * QHSE DEMO : checklists, inspection terminee (NCR ouvertes automatiquement),
 * actions verifiees et NCR cloturee par la direction, incidents sans arret,
 * permis de travail et quart d'heure securite emarge par les employes RH.
 */
export const qhseStep = {
  name: "QHSE (inspections, NCR, incidents, permis)",
  async isDone(api) {
    const templates = await api.get("/qhse/templates");
    return templates.length > 0;
  },
  async run(api) {
    const roles = await api.get("/admin/roles");
    const direction = roles.find((role) => role.name === "Direction (lecture)");
    const needed = ["qhse.inspection.read", "qhse.finding.close", "qhse.incident.manage", "qhse.permit.approve"];
    if (direction && needed.some((key) => !direction.permissions.includes(key))) {
      await api.put(`/admin/roles/${direction.id}/permissions`, { permissions: [...new Set([...direction.permissions, ...needed])] });
    }
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const director = createClient(api.baseUrl);
    await director.post("/auth/login", { email: directionUser.email, password: directionUser.password });

    const projects = await api.get("/projects");
    const project = projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0];
    const projectId = project.id;
    const now = Date.now();
    const day = (offset) => new Date(now + offset * DAY_MS).toISOString().slice(0, 10);

    await api.post("/qhse/templates", {
      code: "SEC-01",
      name: "Visite sécurité hebdomadaire",
      domain: "SAFETY",
      items: [
        { label: "Port des EPI (casque, chaussures, gilet, lunettes)" },
        { label: "Protections collectives en place sur trémies et rives", critical: true },
        { label: "Échafaudages réceptionnés et étiquetés", critical: true },
        { label: "Balisage des zones de levage" },
        { label: "Extincteurs accessibles et vérifiés" },
        { label: "Tri des déchets respecté" },
      ],
    });
    const templates = await api.post("/qhse/templates", {
      code: "QUA-CVC",
      name: "Contrôle qualité réseaux CVC",
      domain: "QUALITY",
      items: [
        { label: "Supports conformes au plan (entraxe ≤ 1,50 m)" },
        { label: "Calorifuge continu, jonctions adhésivées", critical: true },
        { label: "Trappes de visite accessibles" },
        { label: "Étiquetage des réseaux" },
      ],
    });
    const sec = templates.find((template) => template.code === "SEC-01").id;
    const qua = templates.find((template) => template.code === "QUA-CVC").id;

    // Inspection securite terminee : 2 points non conformes -> 2 NCR automatiques.
    const inspection = await api.post("/qhse/inspections", { projectId, templateId: sec, title: `Visite sécurité — semaine du ${day(-3)}`, scheduledAt: day(-3) });
    const answers = [
      { result: "CONFORM" },
      { result: "NON_CONFORM", comment: "Trémie de gaine palière au niveau 2 sans garde-corps ni plancher provisoire.", photo: "roof" },
      { result: "CONFORM" },
      { result: "NON_CONFORM", comment: "Levage de la CTA sans balisage au sol côté accès livraisons." },
      { result: "CONFORM" },
      { result: "NOT_APPLICABLE", comment: "Bennes non encore livrées." },
    ];
    for (const [index, item] of inspection.items.entries()) {
      const answer = answers[index];
      const fileId = answer.photo ? (await api.upload(scenePng(answer.photo, 40 + index), `insp-${index + 1}.png`, "image/png")).id : undefined;
      await api.put(`/qhse/inspections/${inspection.id}/items/${item.id}`, { result: answer.result, comment: answer.comment, fileId });
    }
    const completed = await api.post(`/qhse/inspections/${inspection.id}/complete`);
    const [tremie, levage] = completed.items.filter((item) => item.findingId).map((item) => item.findingId);

    // NCR trémie : action réalisée, vérifiée par la direction, NCR clôturée par la direction.
    let finding = await api.post(`/qhse/findings/${tremie}/actions`, { description: "Poser garde-corps et plancher provisoire sur la trémie N2", assigneeName: "Gros œuvre — chef d'équipe", dueDate: day(-1) });
    const proof = await api.upload(scenePng("roofFixed", 51), "tremie-corrigee.png", "image/png");
    await api.post(`/qhse/actions/${finding.actions[0].id}/complete`, { note: "Garde-corps et plancher posés, contrôle visuel fait.", fileId: proof.id });
    await director.post(`/qhse/actions/${finding.actions[0].id}/verify`, { note: "Vérifié sur place." });
    await director.post(`/qhse/findings/${tremie}/close`, { note: "Protection collective efficace." });

    // NCR levage : action realisee, en attente de verification.
    finding = await api.post(`/qhse/findings/${levage}/actions`, { description: "Baliser la zone de levage et désigner un chef de manœuvre", assigneeName: "Levage Kin SARL", dueDate: day(4) });
    await api.post(`/qhse/actions/${finding.actions[0].id}/complete`, { note: "Balisage posé, chef de manœuvre désigné pour chaque levage." });

    // Inspection qualite planifiee.
    await api.post("/qhse/inspections", { projectId, templateId: qua, title: "Contrôle qualité réseaux CVC niveau 1", scheduledAt: day(2) });

    // Incidents sans arret.
    await api.post("/qhse/incidents", {
      projectId,
      type: "NEAR_MISS",
      severity: "MAJOR",
      occurredAt: new Date(now - DAY_MS - 3 * 3_600_000).toISOString(),
      location: "Accès livraisons, zone de levage",
      description: "Chute d'une élingue depuis 4 m, aucun blessé : zone non balisée.",
      immediateActions: "Arrêt du levage, balisage immédiat.",
    });
    const incidents = await api.post("/qhse/incidents", {
      projectId,
      type: "FIRST_AID",
      severity: "MINOR",
      occurredAt: new Date(now - 9 * DAY_MS).toISOString(),
      location: "Local technique RDC",
      description: "Coupure superficielle à la main lors de la découpe d'une gaine.",
      injuredPerson: "Monteur CVC",
      immediateActions: "Soins à l'infirmerie de chantier.",
    });
    const cut = incidents.find((incident) => incident.type === "FIRST_AID");
    await director.post(`/qhse/incidents/${cut.id}/investigate`, { summary: "Gants anti-coupure non portés : rappel lors du quart d'heure sécurité.", lostDays: 0 });
    await director.post(`/qhse/incidents/${cut.id}/close`);

    // Permis de travail.
    const permits = await api.post("/qhse/permits", {
      projectId,
      type: "HOT_WORK",
      description: "Soudure des supports de la CTA en toiture",
      precautions: "Extincteur à moins de 10 m, bâche ignifugée, surveillance 2 h après la fin des travaux.",
      validFrom: new Date(now - 3_600_000).toISOString(),
      validTo: new Date(now + 7 * 3_600_000).toISOString(),
    });
    await director.post(`/qhse/permits/${permits[0].id}/approve`, { note: "Zone dégagée, permis affiché sur place." });
    await api.post("/qhse/permits", {
      projectId,
      type: "WORK_AT_HEIGHT",
      description: "Pose des gaines en plénum, nacelle ciseaux",
      precautions: "Nacelle vérifiée, harnais, balisage au sol.",
      validFrom: new Date(now + DAY_MS).toISOString(),
      validTo: new Date(now + DAY_MS + 9 * 3_600_000).toISOString(),
    });

    // Quart d'heure securite, emargement des employes (RH).
    const employees = await api.get("/hr/employees");
    await api.post("/qhse/toolbox", {
      projectId,
      heldAt: new Date(now - 2 * 3_600_000).toISOString(),
      topic: "Levage : balisage et chef de manœuvre",
      content: "Retour sur le presque-accident de l'élingue ; rôle du chef de manœuvre ; port des gants anti-coupure.",
      attendeeEmployeeIds: employees.filter((employee) => employee.status === "ACTIVE").map((employee) => employee.id),
    });
  },
};
