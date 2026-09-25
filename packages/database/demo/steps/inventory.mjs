/** Stock DEMO : articles, depot central, magasin de chantier, flux traces. */

const ITEMS = [
  { code: "CIM-425", name: "Ciment CEM II 42.5 (sac 50 kg)", unitCode: "sac", category: "Gros œuvre", minStock: "400", opening: ["620", "9.80"] },
  { code: "HA-12", name: "Acier HA 12 (barre 12 m)", unitCode: "barre", category: "Gros œuvre", minStock: "150", opening: ["180", "14.60"] },
  { code: "PAR-20", name: "Parpaing creux 20x20x50", unitCode: "u", category: "Maçonnerie", minStock: "1500", opening: ["4200", "0.72"] },
  { code: "CAB-3G25", name: "Câble U1000 R2V 3G2,5", unitCode: "ml", category: "Électricité", minStock: "300", opening: ["1250", "1.35"] },
  { code: "DIS-16A", name: "Disjoncteur modulaire 16 A", unitCode: "u", category: "Électricité", minStock: "40", opening: ["18", "11.20"] },
];

export const inventoryStep = {
  name: "Stock (articles, magasins, mouvements)",
  async isDone(api) {
    const items = await api.get("/inventory/items");
    return items.length > 0;
  },
  async run(api) {
    const projects = await api.get("/projects");
    const project = projects[0];
    const central = await api.post("/inventory/warehouses", { code: "MAG-CENTRAL", name: "Dépôt central Lubumbashi", location: "Zone industrielle, Lubumbashi" });
    const site = await api.post("/inventory/warehouses", {
      code: "CHT-STLUC",
      name: "Magasin chantier Saint-Luc",
      kind: "SITE",
      projectId: project.id,
      location: "Clinique Saint-Luc — base vie",
    });
    const items = {};
    for (const item of ITEMS) {
      const created = await api.post("/inventory/items", {
        code: item.code,
        name: item.name,
        unitCode: item.unitCode,
        category: item.category,
        minStock: item.minStock,
      });
      items[item.code] = created;
      await api.post("/inventory/adjustments", {
        warehouseId: central.id,
        itemId: created.id,
        quantityDelta: item.opening[0],
        unitCost: item.opening[1],
        reason: "Stock d'ouverture (reprise de l'inventaire physique au 30/09/2026)",
      });
    }
    await api.post("/inventory/transfers", {
      fromWarehouseId: central.id,
      toWarehouseId: site.id,
      reference: "BT-0001",
      idempotencyKey: "demo-transfer-0001",
      lines: [
        { itemId: items["CIM-425"].id, quantity: "260" },
        { itemId: items["HA-12"].id, quantity: "90" },
        { itemId: items["PAR-20"].id, quantity: "1800" },
      ],
    });
    const detail = await api.get(`/projects/${project.id}`);
    const leaf = Object.fromEntries(detail.wbs.map((node) => [node.code, node.id]));
    await api.post("/inventory/issues", {
      warehouseId: site.id,
      projectId: project.id,
      wbsItemId: leaf["GO-01"],
      reference: "BS-0001",
      idempotencyKey: "demo-issue-0001",
      lines: [
        { itemId: items["CIM-425"].id, quantity: "140" },
        { itemId: items["HA-12"].id, quantity: "45" },
      ],
    });
    await api.post("/inventory/issues", {
      warehouseId: site.id,
      projectId: project.id,
      wbsItemId: leaf["GO-02"],
      reference: "BS-0002",
      idempotencyKey: "demo-issue-0002",
      lines: [{ itemId: items["PAR-20"].id, quantity: "950" }],
    });
    await api.post("/inventory/returns", {
      warehouseId: site.id,
      projectId: project.id,
      reference: "BR-0001",
      idempotencyKey: "demo-return-0001",
      lines: [{ itemId: items["CIM-425"].id, quantity: "12" }],
    });
    await api.post("/inventory/adjustments", {
      warehouseId: site.id,
      itemId: items["PAR-20"].id,
      quantityDelta: "-24",
      reason: "Casse lors du déchargement (constat du 14/10)",
    });
  },
};
