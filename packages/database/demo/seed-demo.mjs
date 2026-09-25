#!/usr/bin/env node
/**
 * Jeu de donnees DEMO d'AXORA-ERP24.
 *
 * - L'organisation creee est marquee `isDemo = true` : l'interface affiche un
 *   bandeau permanent "Organisation de demonstration" (jamais confondue avec
 *   des donnees reelles, docs/foundation/06-product-backlog.md §7).
 * - Toutes les donnees metier sont creees via l'API HTTP reelle : les regles
 *   metier, le RBAC et l'audit s'appliquent exactement comme pour un
 *   utilisateur. Le script sert donc aussi de test de bout en bout.
 * - Idempotent : chaque etape verifie si ses donnees existent deja.
 *
 * Prerequis : API demarree (API_URL, defaut http://localhost:4000/api/v1).
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "./client.mjs";
import { DEMO_STEPS } from "./steps/index.mjs";

export const DEMO_ACCOUNT = {
  organizationName: "AXORA Démo Construction",
  organizationSlug: "axora-demo",
  companyName: "AXORA Démo Construction SARL",
  ownerEmail: "demo@axora-erp24.local",
  ownerPassword: "Demo2026!",
  ownerFullName: "Démo Administrateur",
};

const baseUrl = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}/api/v1`;

async function main() {
  const api = createClient(baseUrl);
  const prisma = new PrismaClient();

  try {
    try {
      await api.post("/auth/login", { email: DEMO_ACCOUNT.ownerEmail, password: DEMO_ACCOUNT.ownerPassword });
      console.log(`Compte DEMO existant : ${DEMO_ACCOUNT.ownerEmail}`);
    } catch (error) {
      if (error.status !== 401) throw error;
      await api.post("/auth/register-organization", DEMO_ACCOUNT);
      console.log(`Organisation DEMO creee : ${DEMO_ACCOUNT.organizationSlug}`);
    }

    // Marquage explicite DEMO (aucune route API ne permet de le faire : c'est
    // une propriete d'exploitation, pas une action utilisateur).
    await prisma.organization.update({
      where: { slug: DEMO_ACCOUNT.organizationSlug },
      data: { isDemo: true },
    });

    const ctx = {};
    for (const step of DEMO_STEPS) {
      if (await step.isDone(api, ctx)) {
        console.log(`  = ${step.name} : deja present`);
        if (step.load) await step.load(api, ctx);
        continue;
      }
      await step.run(api, ctx);
      console.log(`  + ${step.name} : cree`);
    }
    console.log(`\nConnexion : ${DEMO_ACCOUNT.ownerEmail} / ${DEMO_ACCOUNT.ownerPassword}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`Echec du seed DEMO : ${error.message}`);
  process.exit(1);
});
