-- Rattrapage INC-02 : les organisations creees avant l'ajout de l'adhesion
-- entreprise au bootstrap n'avaient aucun CompanyMembership. Leurs
-- utilisateurs se voyaient refuser tout acces aux modules metier
-- (CompanyScopeService -> 403 "User is not a member of any company").
--
-- Rattache chaque utilisateur aux entreprises de SA PROPRE organisation
-- uniquement (jamais de rattachement cross-tenant), et reste idempotent
-- grace a la contrainte d'unicite (userId, companyId).
INSERT INTO "company_memberships" ("id", "userId", "companyId", "createdAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  c."id",
  NOW()
FROM "users" u
JOIN "companies" c ON c."organizationId" = u."organizationId"
WHERE NOT EXISTS (
  SELECT 1
  FROM "company_memberships" m
  WHERE m."userId" = u."id" AND m."companyId" = c."id"
);
