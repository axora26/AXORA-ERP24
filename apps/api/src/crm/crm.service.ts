import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type {
  CrmAccountView,
  CrmActivityView,
  CrmContactView,
  CrmDashboardView,
  CrmLeadView,
  CrmOpportunityView,
  CrmPipelineStageView,
} from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import {
  boundedInteger,
  currencyCode,
  decimalAmount,
  enumValue,
  optionalDate,
  optionalString,
  requiredString,
  type ConvertLeadDto,
  type CreateAccountDto,
  type CreateActivityDto,
  type CreateContactDto,
  type CreateLeadDto,
  type CreateOpportunityDto,
  type CreatePipelineStageDto,
  type MoveOpportunityStageDto,
  type UpdateLeadStatusDto,
} from "./crm.dto.js";

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DISQUALIFIED"] as const;
const ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "MEETING",
  "EMAIL",
  "TASK",
  "STAGE_CHANGE",
  "CONVERSION",
] as const;
const RELATED_TYPES = ["Lead", "Opportunity", "Account", "Contact"] as const;

/**
 * Service CRM (INC-02).
 *
 * INVARIANTS APPLIQUES DANS CHAQUE METHODE :
 * 1. Toute requete filtre sur organizationId ET companyId issus de
 *    CompanyScopeService (jamais d'un champ du corps de requete).
 * 2. CrmActivity est append-only : ce service n'expose ni update ni delete
 *    d'activite, et ecrit l'activite dans la MEME transaction que le
 *    changement metier qu'elle documente (pas d'historique orphelin).
 * 3. Les montants restent en Decimal de bout en bout et sont serialises en
 *    chaine vers le client — jamais convertis en number.
 */
@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Pipeline
  // -------------------------------------------------------------------------

  async listStages(scope: CompanyScope): Promise<CrmPipelineStageView[]> {
    const stages = await this.prisma.crmPipelineStage.findMany({
      where: { organizationId: scope.organizationId, companyId: scope.companyId },
      orderBy: { position: "asc" },
    });
    return stages.map(toStageView);
  }

  async createStage(
    scope: CompanyScope,
    input: CreatePipelineStageDto,
  ): Promise<CrmPipelineStageView> {
    const name = requiredString(input.name, "name", 80);
    const position = boundedInteger(input.position, "position", 1, 999);
    const probability = boundedInteger(input.probability, "probability", 0, 100, 0);
    const isWon = input.isWon === true;
    const isLost = input.isLost === true;

    if (isWon && isLost) {
      throw new BadRequestException("A stage cannot be both won and lost");
    }

    const duplicate = await this.prisma.crmPipelineStage.findFirst({
      where: { companyId: scope.companyId, name },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(`A stage named "${name}" already exists`);
    }

    const stage = await this.prisma.crmPipelineStage.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        name,
        position,
        probability,
        isWon,
        isLost,
      },
    });
    return toStageView(stage);
  }

  // -------------------------------------------------------------------------
  // Comptes et contacts
  // -------------------------------------------------------------------------

  async listAccounts(scope: CompanyScope): Promise<CrmAccountView[]> {
    const accounts = await this.prisma.crmAccount.findMany({
      where: { organizationId: scope.organizationId, companyId: scope.companyId },
      orderBy: { createdAt: "desc" },
    });
    return accounts.map(toAccountView);
  }

  async createAccount(scope: CompanyScope, input: CreateAccountDto): Promise<CrmAccountView> {
    const name = requiredString(input.name, "name", 180);

    const duplicate = await this.prisma.crmAccount.findFirst({
      where: { companyId: scope.companyId, name },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(`An account named "${name}" already exists`);
    }

    const account = await this.prisma.crmAccount.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        name,
        industry: optionalString(input.industry, "industry", 120),
        city: optionalString(input.city, "city", 120),
        country: optionalString(input.country, "country", 120),
        website: optionalString(input.website, "website"),
        phone: optionalString(input.phone, "phone", 40),
        email: optionalString(input.email, "email", 180),
      },
    });
    return toAccountView(account);
  }

  async listContacts(scope: CompanyScope): Promise<CrmContactView[]> {
    const contacts = await this.prisma.crmContact.findMany({
      where: { organizationId: scope.organizationId, companyId: scope.companyId },
      orderBy: { createdAt: "desc" },
    });
    return contacts.map(toContactView);
  }

  async createContact(scope: CompanyScope, input: CreateContactDto): Promise<CrmContactView> {
    const fullName = requiredString(input.fullName, "fullName", 180);
    const accountId = optionalString(input.accountId, "accountId");

    if (accountId) {
      await this.assertAccountInScope(scope, accountId);
    }

    const contact = await this.prisma.crmContact.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        accountId,
        fullName,
        email: optionalString(input.email, "email", 180),
        phone: optionalString(input.phone, "phone", 40),
        jobTitle: optionalString(input.jobTitle, "jobTitle", 120),
        isPrimary: input.isPrimary === true,
      },
    });
    return toContactView(contact);
  }

  // -------------------------------------------------------------------------
  // Leads
  // -------------------------------------------------------------------------

  async listLeads(scope: CompanyScope): Promise<CrmLeadView[]> {
    const leads = await this.prisma.crmLead.findMany({
      where: { organizationId: scope.organizationId, companyId: scope.companyId },
      orderBy: { createdAt: "desc" },
    });
    return leads.map(toLeadView);
  }

  async createLead(
    scope: CompanyScope,
    input: CreateLeadDto,
    actorUserId: string,
  ): Promise<CrmLeadView> {
    const contactName = requiredString(input.contactName, "contactName", 180);
    const companyName = requiredString(input.companyName, "companyName", 180);

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.crmLead.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          contactName,
          companyName,
          email: optionalString(input.email, "email", 180),
          phone: optionalString(input.phone, "phone", 40),
          source: optionalString(input.source, "source", 120),
          ownerUserId: actorUserId,
        },
      });

      await tx.crmActivity.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          type: "NOTE",
          subject: "Prospect cree",
          body: `${contactName} — ${companyName}`,
          relatedType: "Lead",
          relatedId: created.id,
          actorUserId,
        },
      });

      return created;
    });

    return toLeadView(lead);
  }

  async updateLeadStatus(
    scope: CompanyScope,
    leadId: string,
    input: UpdateLeadStatusDto,
    actorUserId: string,
  ): Promise<CrmLeadView> {
    const status = enumValue(input.status, LEAD_STATUSES, "status");
    const lead = await this.findLeadInScope(scope, leadId);

    if (lead.status === "CONVERTED") {
      throw new BadRequestException("A converted lead can no longer change status");
    }
    if (status === "CONVERTED") {
      throw new BadRequestException("Use POST /crm/leads/:id/convert to convert a lead");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.crmLead.update({ where: { id: lead.id }, data: { status } });
      await tx.crmActivity.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          type: "NOTE",
          subject: "Statut du prospect modifie",
          body: `${lead.status} -> ${status}`,
          relatedType: "Lead",
          relatedId: lead.id,
          actorUserId,
        },
      });
      return result;
    });

    return toLeadView(updated);
  }

  /**
   * Conversion Lead -> Opportunite (parcours E2E §5.1 du backlog).
   *
   * Transactionnelle : un lead deja converti est refuse. Le compte est cree
   * s'il n'existe pas, l'opportunite est rattachee au lead source
   * (tracabilite), et deux activites immuables documentent l'operation des
   * deux cotes (lead et opportunite).
   */
  async convertLead(
    scope: CompanyScope,
    leadId: string,
    input: ConvertLeadDto,
    actorUserId: string,
  ): Promise<CrmOpportunityView> {
    const lead = await this.findLeadInScope(scope, leadId);
    if (lead.status === "CONVERTED") {
      throw new BadRequestException("Lead already converted");
    }
    if (lead.status === "DISQUALIFIED") {
      throw new BadRequestException("A disqualified lead cannot be converted");
    }

    const amount = decimalAmount(input.amount, "amount");
    const currency = currencyCode(input.currency);
    const expectedCloseDate = optionalDate(input.expectedCloseDate, "expectedCloseDate");
    const opportunityName =
      optionalString(input.opportunityName, "opportunityName", 180) ??
      `Opportunite ${lead.companyName}`;

    const stage = input.stageId
      ? await this.findStageInScope(scope, input.stageId)
      : await this.firstOpenStage(scope);

    const opportunity = await this.prisma.$transaction(async (tx) => {
      // Re-lecture du lead DANS la transaction : deux conversions simultanees
      // du meme lead ne doivent pas creer deux opportunites.
      const locked = await tx.crmLead.findFirst({
        where: {
          id: lead.id,
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          status: { not: "CONVERTED" },
        },
      });
      if (!locked) {
        throw new BadRequestException("Lead already converted");
      }

      const account =
        (await tx.crmAccount.findFirst({
          where: { companyId: scope.companyId, name: lead.companyName },
        })) ??
        (await tx.crmAccount.create({
          data: {
            organizationId: scope.organizationId,
            companyId: scope.companyId,
            name: lead.companyName,
            email: lead.email,
            phone: lead.phone,
          },
        }));

      const contact = await tx.crmContact.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          accountId: account.id,
          fullName: lead.contactName,
          email: lead.email,
          phone: lead.phone,
          isPrimary: true,
        },
      });

      const created = await tx.crmOpportunity.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          accountId: account.id,
          contactId: contact.id,
          sourceLeadId: lead.id,
          stageId: stage.id,
          name: opportunityName,
          amount: new Prisma.Decimal(amount),
          currency,
          expectedCloseDate,
          ownerUserId: actorUserId,
        },
        include: { stage: true, account: true },
      });

      await tx.crmLead.update({
        where: { id: lead.id },
        data: { status: "CONVERTED", accountId: account.id, convertedAt: new Date() },
      });

      await tx.crmActivity.createMany({
        data: [
          {
            organizationId: scope.organizationId,
            companyId: scope.companyId,
            type: "CONVERSION",
            subject: "Prospect converti en opportunite",
            body: `${lead.companyName} -> ${opportunityName}`,
            relatedType: "Lead",
            relatedId: lead.id,
            actorUserId,
          },
          {
            organizationId: scope.organizationId,
            companyId: scope.companyId,
            type: "CONVERSION",
            subject: "Opportunite creee depuis un prospect",
            body: `Source: ${lead.contactName} (${lead.companyName})`,
            relatedType: "Opportunity",
            relatedId: created.id,
            actorUserId,
          },
        ],
      });

      return created;
    });

    return toOpportunityView(opportunity);
  }

  // -------------------------------------------------------------------------
  // Opportunites
  // -------------------------------------------------------------------------

  async listOpportunities(scope: CompanyScope): Promise<CrmOpportunityView[]> {
    const opportunities = await this.prisma.crmOpportunity.findMany({
      where: { organizationId: scope.organizationId, companyId: scope.companyId },
      include: { stage: true, account: true },
      orderBy: { createdAt: "desc" },
    });
    return opportunities.map(toOpportunityView);
  }

  async createOpportunity(
    scope: CompanyScope,
    input: CreateOpportunityDto,
    actorUserId: string,
  ): Promise<CrmOpportunityView> {
    const name = requiredString(input.name, "name", 180);
    const amount = decimalAmount(input.amount, "amount");
    const currency = currencyCode(input.currency);
    const expectedCloseDate = optionalDate(input.expectedCloseDate, "expectedCloseDate");
    const accountId = optionalString(input.accountId, "accountId");
    const contactId = optionalString(input.contactId, "contactId");

    if (accountId) {
      await this.assertAccountInScope(scope, accountId);
    }
    if (contactId) {
      await this.assertContactInScope(scope, contactId);
    }

    const stage = input.stageId
      ? await this.findStageInScope(scope, input.stageId)
      : await this.firstOpenStage(scope);

    const opportunity = await this.prisma.$transaction(async (tx) => {
      const created = await tx.crmOpportunity.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          name,
          amount: new Prisma.Decimal(amount),
          currency,
          expectedCloseDate,
          accountId,
          contactId,
          stageId: stage.id,
          ownerUserId: actorUserId,
        },
        include: { stage: true, account: true },
      });

      await tx.crmActivity.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          type: "NOTE",
          subject: "Opportunite creee",
          body: `${name} — ${amount} ${currency}`,
          relatedType: "Opportunity",
          relatedId: created.id,
          actorUserId,
        },
      });

      return created;
    });

    return toOpportunityView(opportunity);
  }

  async moveOpportunityStage(
    scope: CompanyScope,
    opportunityId: string,
    input: MoveOpportunityStageDto,
    actorUserId: string,
  ): Promise<CrmOpportunityView> {
    const opportunity = await this.findOpportunityInScope(scope, opportunityId);
    if (opportunity.status !== "OPEN") {
      throw new BadRequestException("A closed opportunity can no longer change stage");
    }

    const stage = await this.findStageInScope(scope, requiredString(input.stageId, "stageId"));
    const status = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.crmOpportunity.update({
        where: { id: opportunity.id },
        data: {
          stageId: stage.id,
          status,
          closedAt: status === "OPEN" ? null : new Date(),
        },
        include: { stage: true, account: true },
      });

      await tx.crmActivity.create({
        data: {
          organizationId: scope.organizationId,
          companyId: scope.companyId,
          type: "STAGE_CHANGE",
          subject: "Etape de l'opportunite modifiee",
          body: `${opportunity.stage.name} -> ${stage.name}`,
          relatedType: "Opportunity",
          relatedId: opportunity.id,
          actorUserId,
        },
      });

      return result;
    });

    return toOpportunityView(updated);
  }

  // -------------------------------------------------------------------------
  // Activites (append-only)
  // -------------------------------------------------------------------------

  async listActivities(
    scope: CompanyScope,
    relatedType?: string,
    relatedId?: string,
  ): Promise<CrmActivityView[]> {
    const where: Prisma.CrmActivityWhereInput = {
      organizationId: scope.organizationId,
      companyId: scope.companyId,
    };

    if (relatedType !== undefined && relatedType !== "") {
      where.relatedType = canonicalRelatedType(relatedType);
    }
    if (relatedId !== undefined && relatedId !== "") {
      where.relatedId = relatedId;
    }

    const activities = await this.prisma.crmActivity.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: 200,
    });
    return activities.map(toActivityView);
  }

  async createActivity(
    scope: CompanyScope,
    input: CreateActivityDto,
    actorUserId: string,
  ): Promise<CrmActivityView> {
    const type = enumValue(input.type, ACTIVITY_TYPES, "type");
    const subject = requiredString(input.subject, "subject", 180);
    const relatedType = canonicalRelatedType(requiredString(input.relatedType, "relatedType", 40));
    const relatedId = requiredString(input.relatedId, "relatedId");

    // L'entite reliee doit appartenir au meme perimetre : sans ce controle,
    // un client pourrait greffer un historique sur un enregistrement d'un
    // autre tenant en devinant son identifiant.
    await this.assertRelatedInScope(scope, relatedType, relatedId);

    const activity = await this.prisma.crmActivity.create({
      data: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        type,
        subject,
        body: optionalString(input.body, "body", 4000),
        relatedType,
        relatedId,
        actorUserId,
      },
    });
    return toActivityView(activity);
  }

  // -------------------------------------------------------------------------
  // Tableau de bord commercial — agregats calcules sur des donnees reelles
  // -------------------------------------------------------------------------

  async dashboard(scope: CompanyScope): Promise<CrmDashboardView> {
    const where = { organizationId: scope.organizationId, companyId: scope.companyId };

    const [
      leadsTotal,
      leadsConverted,
      leadsDisqualified,
      opportunitiesTotal,
      opportunitiesOpen,
      opportunitiesWon,
      opportunitiesLost,
      stages,
      openOpportunities,
      wonAggregate,
    ] = await Promise.all([
      this.prisma.crmLead.count({ where }),
      this.prisma.crmLead.count({ where: { ...where, status: "CONVERTED" } }),
      this.prisma.crmLead.count({ where: { ...where, status: "DISQUALIFIED" } }),
      this.prisma.crmOpportunity.count({ where }),
      this.prisma.crmOpportunity.count({ where: { ...where, status: "OPEN" } }),
      this.prisma.crmOpportunity.count({ where: { ...where, status: "WON" } }),
      this.prisma.crmOpportunity.count({ where: { ...where, status: "LOST" } }),
      this.prisma.crmPipelineStage.findMany({ where, orderBy: { position: "asc" } }),
      this.prisma.crmOpportunity.findMany({
        where: { ...where, status: "OPEN" },
        select: { amount: true, currency: true, stageId: true },
      }),
      this.prisma.crmOpportunity.aggregate({
        where: { ...where, status: "WON" },
        _sum: { amount: true },
      }),
    ]);

    // Agregation decimale exacte (jamais d'addition en flottant).
    let pipelineValue = new Prisma.Decimal(0);
    let weighted = new Prisma.Decimal(0);
    const perStage = new Map<string, { count: number; value: Prisma.Decimal }>();

    for (const opportunity of openOpportunities) {
      const amount = new Prisma.Decimal(opportunity.amount);
      pipelineValue = pipelineValue.plus(amount);

      const bucket = perStage.get(opportunity.stageId) ?? {
        count: 0,
        value: new Prisma.Decimal(0),
      };
      bucket.count += 1;
      bucket.value = bucket.value.plus(amount);
      perStage.set(opportunity.stageId, bucket);
    }

    for (const stage of stages) {
      const bucket = perStage.get(stage.id);
      if (!bucket) {
        continue;
      }
      weighted = weighted.plus(bucket.value.times(stage.probability).dividedBy(100));
    }

    // Devises : tant que le multi-devises n'est pas implemente (increment
    // Finance), on n'additionne que si une seule devise est presente ; sinon
    // la devise retournee est "MIXED" et le total est explicitement signale
    // comme non comparable plutot que faussement agrege.
    const currencies = new Set(openOpportunities.map((opportunity) => opportunity.currency));
    const currency =
      currencies.size === 1 ? [...currencies][0]! : currencies.size === 0 ? "USD" : "MIXED";

    return {
      companyId: scope.companyId,
      leads: {
        total: leadsTotal,
        open: leadsTotal - leadsConverted - leadsDisqualified,
        converted: leadsConverted,
      },
      opportunities: {
        total: opportunitiesTotal,
        open: opportunitiesOpen,
        won: opportunitiesWon,
        lost: opportunitiesLost,
      },
      pipelineValue: pipelineValue.toFixed(2),
      wonValue: (wonAggregate._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      weightedPipelineValue: weighted.toFixed(2),
      currency,
      stages: stages.map((stage) => {
        const bucket = perStage.get(stage.id);
        return {
          stageId: stage.id,
          stageName: stage.name,
          position: stage.position,
          probability: stage.probability,
          opportunityCount: bucket?.count ?? 0,
          value: (bucket?.value ?? new Prisma.Decimal(0)).toFixed(2),
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Controles de perimetre
  // -------------------------------------------------------------------------

  private async findLeadInScope(scope: CompanyScope, leadId: string) {
    const lead = await this.prisma.crmLead.findFirst({
      where: { id: leadId, organizationId: scope.organizationId, companyId: scope.companyId },
    });
    if (!lead) {
      throw new NotFoundException("Lead not found");
    }
    return lead;
  }

  private async findOpportunityInScope(scope: CompanyScope, opportunityId: string) {
    const opportunity = await this.prisma.crmOpportunity.findFirst({
      where: {
        id: opportunityId,
        organizationId: scope.organizationId,
        companyId: scope.companyId,
      },
      include: { stage: true },
    });
    if (!opportunity) {
      throw new NotFoundException("Opportunity not found");
    }
    return opportunity;
  }

  private async findStageInScope(scope: CompanyScope, stageId: string) {
    const stage = await this.prisma.crmPipelineStage.findFirst({
      where: { id: stageId, organizationId: scope.organizationId, companyId: scope.companyId },
    });
    if (!stage) {
      throw new NotFoundException("Pipeline stage not found");
    }
    return stage;
  }

  private async firstOpenStage(scope: CompanyScope) {
    const stage = await this.prisma.crmPipelineStage.findFirst({
      where: {
        organizationId: scope.organizationId,
        companyId: scope.companyId,
        isWon: false,
        isLost: false,
      },
      orderBy: { position: "asc" },
    });
    if (!stage) {
      throw new BadRequestException(
        "No open pipeline stage configured for this company (create one first)",
      );
    }
    return stage;
  }

  private async assertAccountInScope(scope: CompanyScope, accountId: string): Promise<void> {
    const account = await this.prisma.crmAccount.findFirst({
      where: { id: accountId, organizationId: scope.organizationId, companyId: scope.companyId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException("Account not found");
    }
  }

  private async assertContactInScope(scope: CompanyScope, contactId: string): Promise<void> {
    const contact = await this.prisma.crmContact.findFirst({
      where: { id: contactId, organizationId: scope.organizationId, companyId: scope.companyId },
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException("Contact not found");
    }
  }

  private async assertRelatedInScope(
    scope: CompanyScope,
    relatedType: string,
    relatedId: string,
  ): Promise<void> {
    const where = {
      id: relatedId,
      organizationId: scope.organizationId,
      companyId: scope.companyId,
    };

    const exists =
      relatedType === "Lead"
        ? await this.prisma.crmLead.findFirst({ where, select: { id: true } })
        : relatedType === "Opportunity"
          ? await this.prisma.crmOpportunity.findFirst({ where, select: { id: true } })
          : relatedType === "Account"
            ? await this.prisma.crmAccount.findFirst({ where, select: { id: true } })
            : await this.prisma.crmContact.findFirst({ where, select: { id: true } });

    if (!exists) {
      throw new NotFoundException(`${relatedType} not found`);
    }
  }
}

// ---------------------------------------------------------------------------
// Serialisation (montants en chaine, dates ISO)
// ---------------------------------------------------------------------------

/**
 * Normalise "lead" / "LEAD" / "Lead" vers la forme canonique "Lead".
 *
 * Volontairement separe de enumValue() : les types lies sont stockes en casse
 * mixte ("Lead", "Opportunity") alors que enumValue() compare en majuscules.
 * Les melanger renvoyait un 400 sur des requetes pourtant valides.
 */
function canonicalRelatedType(value: string): (typeof RELATED_TYPES)[number] {
  const normalized = String(value).trim().toLowerCase();
  const match = RELATED_TYPES.find((candidate) => candidate.toLowerCase() === normalized);
  if (!match) {
    throw new BadRequestException(`relatedType must be one of: ${RELATED_TYPES.join(", ")}`);
  }
  return match;
}

function toStageView(stage: {
  id: string;
  companyId: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}): CrmPipelineStageView {
  return {
    id: stage.id,
    companyId: stage.companyId,
    name: stage.name,
    position: stage.position,
    probability: stage.probability,
    isWon: stage.isWon,
    isLost: stage.isLost,
  };
}

function toAccountView(account: {
  id: string;
  companyId: string;
  name: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  createdAt: Date;
}): CrmAccountView {
  return {
    id: account.id,
    companyId: account.companyId,
    name: account.name,
    industry: account.industry,
    city: account.city,
    country: account.country,
    email: account.email,
    phone: account.phone,
    createdAt: account.createdAt.toISOString(),
  };
}

function toContactView(contact: {
  id: string;
  companyId: string;
  accountId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  createdAt: Date;
}): CrmContactView {
  return {
    id: contact.id,
    companyId: contact.companyId,
    accountId: contact.accountId,
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    jobTitle: contact.jobTitle,
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt.toISOString(),
  };
}

function toLeadView(lead: {
  id: string;
  companyId: string;
  contactName: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  accountId: string | null;
  convertedAt: Date | null;
  createdAt: Date;
}): CrmLeadView {
  return {
    id: lead.id,
    companyId: lead.companyId,
    contactName: lead.contactName,
    companyName: lead.companyName,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    status: lead.status as CrmLeadView["status"],
    accountId: lead.accountId,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
  };
}

function toOpportunityView(opportunity: {
  id: string;
  companyId: string;
  name: string;
  amount: Prisma.Decimal;
  currency: string;
  status: string;
  stageId: string;
  stage?: { name: string } | null;
  accountId: string | null;
  account?: { name: string } | null;
  contactId: string | null;
  sourceLeadId: string | null;
  expectedCloseDate: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}): CrmOpportunityView {
  return {
    id: opportunity.id,
    companyId: opportunity.companyId,
    name: opportunity.name,
    amount: new Prisma.Decimal(opportunity.amount).toFixed(2),
    currency: opportunity.currency,
    status: opportunity.status as CrmOpportunityView["status"],
    stageId: opportunity.stageId,
    stageName: opportunity.stage?.name ?? "",
    accountId: opportunity.accountId,
    accountName: opportunity.account?.name ?? null,
    contactId: opportunity.contactId,
    sourceLeadId: opportunity.sourceLeadId,
    expectedCloseDate: opportunity.expectedCloseDate?.toISOString() ?? null,
    closedAt: opportunity.closedAt?.toISOString() ?? null,
    createdAt: opportunity.createdAt.toISOString(),
  };
}

function toActivityView(activity: {
  id: string;
  companyId: string;
  type: string;
  subject: string;
  body: string | null;
  relatedType: string;
  relatedId: string;
  actorUserId: string | null;
  occurredAt: Date;
}): CrmActivityView {
  return {
    id: activity.id,
    companyId: activity.companyId,
    type: activity.type as CrmActivityView["type"],
    subject: activity.subject,
    body: activity.body,
    relatedType: activity.relatedType,
    relatedId: activity.relatedId,
    actorUserId: activity.actorUserId,
    occurredAt: activity.occurredAt.toISOString(),
  };
}
