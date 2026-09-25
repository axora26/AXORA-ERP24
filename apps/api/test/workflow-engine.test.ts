import { describe, expect, it } from "vitest";
import { allConditionsHold, conditionHolds, nextRetryDelayMs, render, signWebhook, verifyWebhook } from "../src/workflow/engine.js";

describe("Workflow — moteur de conditions et signature", () => {
  it("conditions decimales exactes, texte, champ absent jamais satisfait", () => {
    expect(conditionHolds({ field: "total", operator: "gt", value: "10000" }, { total: "10000.01" }, "decimal")).toBe(true);
    expect(conditionHolds({ field: "total", operator: "gt", value: "10000" }, { total: "10000.00" }, "decimal")).toBe(false);
    expect(conditionHolds({ field: "total", operator: "gte", value: "0.3" }, { total: "0.30" }, "decimal")).toBe(true);
    expect(conditionHolds({ field: "total", operator: "gt", value: "1" }, { total: "abc" }, "decimal")).toBe(false);
    expect(conditionHolds({ field: "severity", operator: "eq", value: "CRITICAL" }, { severity: "CRITICAL" }, "text")).toBe(true);
    expect(conditionHolds({ field: "title", operator: "contains", value: "béton" }, { title: "Livraison BÉTON" }, "text")).toBe(true);
    expect(conditionHolds({ field: "missing", operator: "neq", value: "x" }, {}, "text")).toBe(false);
    expect(allConditionsHold([{ field: "total", operator: "gt", value: "100" }, { field: "matchStatus", operator: "neq", value: "MATCHED" }], { total: "150", matchStatus: "DISCREPANCY" }, { total: "decimal", matchStatus: "text" })).toBe(true);
    expect(allConditionsHold([], {}, {})).toBe(true);
  });

  it("gabarits en texte brut", () => {
    expect(render("Facture {{code}} de {{ supplierName }} : {{total}} {{currency}}{{absent}}", { code: "FF-1", supplierName: "Acme", total: "12.50", currency: "USD" })).toBe("Facture FF-1 de Acme : 12.50 USD");
  });

  it("signature HMAC horodatee : verification, alteration et rejeu refuses", () => {
    const now = Date.UTC(2026, 8, 25, 8, 0, 0);
    const timestamp = String(Math.floor(now / 1000));
    const body = JSON.stringify({ type: "finance.payable.recorded", data: { total: "12000.00" } });
    const signature = signWebhook("s3cr3t", timestamp, body);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyWebhook("s3cr3t", timestamp, body, signature, now)).toBe(true);
    expect(verifyWebhook("s3cr3t", timestamp, body.replace("12000", "99000"), signature, now)).toBe(false);
    expect(verifyWebhook("autre", timestamp, body, signature, now)).toBe(false);
    expect(verifyWebhook("s3cr3t", timestamp, body, signature, now + 10 * 60_000)).toBe(false);
  });

  it("calendrier de nouvelles tentatives borne", () => {
    expect([1, 2, 3, 4, 5].map(nextRetryDelayMs)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, null]);
  });
});

describe("Workflow — politique de cible webhook", () => {
  it("HTTPS public admis ; local, prive, identifiants et HTTP refuses hors autorisation explicite", async () => {
    const { webhookTargetRefusal } = await import("../src/workflow/engine.js");
    expect(webhookTargetRefusal("https://hooks.example.com/axora", false)).toBeNull();
    expect(webhookTargetRefusal("http://hooks.example.com/axora", false)).toBe("HTTPS obligatoire");
    expect(webhookTargetRefusal("https://127.0.0.1/x", false)).toBe("adresse locale ou privée interdite");
    expect(webhookTargetRefusal("https://10.2.3.4/x", false)).toBe("adresse locale ou privée interdite");
    expect(webhookTargetRefusal("https://169.254.169.254/latest", false)).toBe("adresse locale ou privée interdite");
    expect(webhookTargetRefusal("https://[::1]/x", false)).toBe("adresse locale ou privée interdite");
    expect(webhookTargetRefusal("https://user:pw@hooks.example.com/", false)).toBe("identifiants interdits dans l'URL");
    expect(webhookTargetRefusal("pas une url", false)).toBe("URL invalide");
    expect(webhookTargetRefusal("http://127.0.0.1:9999/hook", true)).toBeNull();
  });
});
