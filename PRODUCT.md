# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AXORA ERP24 sert simultanément la direction générale, la direction commerciale, les responsables CRM, les équipes commerciales terrain et les administrateurs ERP. La vague premium doit permettre à chacun de comprendre les priorités, d’agir sur les engagements commerciaux et de conserver une vue fiable du client.

## Product Purpose

Centraliser l’exécution ERP et CRM d’une organisation multi-sociétés dans une plateforme professionnelle. Le succès signifie que les utilisateurs identifient immédiatement ce qui exige leur attention, accèdent aux informations client consolidées et exécutent les prochaines actions sans rupture entre navigation, données et historique.

## Positioning

AXORA ERP24 relie un pilotage opérationnel multi-tenant strict, des permissions serveur, un historique auditable et des workflows ERP/CRM réellement exécutables dans une même plateforme.

## Operating Context

Les utilisateurs travaillent sur ordinateur, tablette et mobile, souvent avec des volumes importants, plusieurs sociétés, plusieurs devises et des rôles différents. Les flux critiques incluent le pilotage du pipeline, la qualification des prospects, la gestion des comptes et contacts, les activités commerciales, les prochaines actions, les validations et l’accès rapide aux modules ERP.

## Capabilities and Constraints

- Architecture Next.js, NestJS, Prisma et PostgreSQL existante.
- Isolation obligatoire par `organizationId` et `companyId`.
- RBAC appliqué côté serveur et audit des mutations sensibles.
- Conservation des fonctions existantes, de la MFA et des invariants de sécurité.
- Les montants multi-devises ne sont jamais agrégés sans conversion explicite.
- Les activités CRM restent immuables ; les prochaines actions sont des engagements mutables, versionnés et auditables.
- Aucun contrôle factice, aucune donnée commerciale inventée et aucun total ERP non relié au compte CRM.

## Brand Commitments

Nom AXORA ERP24. Identité bleu profond et bleu d’action, typographies Montserrat et Inter, ton professionnel, direct et opérationnel. Le design system existant reste l’autorité visuelle et doit être consolidé plutôt que remplacé.

## Evidence on Hand

Le dépôt contient des données CRM réelles par tenant, le pipeline, les comptes, contacts, prospects, opportunités, activités immuables, permissions, audits, tests E2E PostgreSQL et un design system maître dans `design-system/axora-erp24/MASTER.md`. Aucun témoignage, benchmark commercial ou métrique client externe ne doit être fabriqué.

## Product Principles

1. Montrer d’abord ce qui demande une décision ou une action.
2. Une donnée affichée doit être réelle, scoped et traçable.
3. Préserver la continuité entre vue exécutive, client 360 et action opérationnelle.
4. La densité doit accélérer la lecture sans réduire la lisibilité.
5. Chaque fonction visible doit être accessible, responsive et réellement exécutable.

## Accessibility & Inclusion

Cible WCAG 2.1 AA, navigation clavier complète, relations ARIA explicites, libellés visibles, focus restauré, cibles tactiles de 44 px et utilisabilité à 200 % de zoom. Vérification aux largeurs 375, 390, 768, 1024 et 1440 px.
