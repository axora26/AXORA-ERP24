-- Rattrapage INC-02 : dote d'un pipeline par defaut les entreprises creees
-- avant l'ajout des etapes au bootstrap. Sans etape ouverte, toute creation
-- d'opportunite est refusee (400 "No open pipeline stage configured").
--
-- Source de verite des valeurs : apps/api/src/crm/pipeline.defaults.ts.
-- Toute modification doit etre repercutee des deux cotes.
-- Ne touche QUE les entreprises sans aucune etape (idempotent).
INSERT INTO "crm_pipeline_stages"
  ("id", "organizationId", "companyId", "name", "position", "probability", "isWon", "isLost", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."organizationId",
  c."id",
  seed.name,
  seed.position,
  seed.probability,
  seed.is_won,
  seed.is_lost,
  NOW(),
  NOW()
FROM "companies" c
CROSS JOIN (
  VALUES
    ('Qualification',      1, 10,  false, false),
    ('Analyse du besoin',  2, 25,  false, false),
    ('Proposition',        3, 50,  false, false),
    ('Negociation',        4, 75,  false, false),
    ('Gagnee',             5, 100, true,  false),
    ('Perdue',             6, 0,   false, true)
) AS seed(name, position, probability, is_won, is_lost)
WHERE NOT EXISTS (
  SELECT 1 FROM "crm_pipeline_stages" s WHERE s."companyId" = c."id"
);
