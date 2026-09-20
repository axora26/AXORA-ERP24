/**
 * Seed DEMO — donnees explicitement marquees isDemo=true, jamais confondues
 * avec des donnees de production (docs/foundation/06-product-backlog.md §7).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "axora-demo" },
    update: {},
    create: {
      name: "AXORA Demo",
      slug: "axora-demo",
      isDemo: true,
    },
  });

  await prisma.company.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "AXORA Demo SARL" } },
    update: {},
    create: {
      organizationId: org.id,
      name: "AXORA Demo SARL",
      legalName: "AXORA Demo SARL",
    },
  });

  console.log(`Seed DEMO termine: organisation "${org.slug}" (isDemo=true)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
