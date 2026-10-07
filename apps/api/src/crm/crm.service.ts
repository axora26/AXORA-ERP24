import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import { CRM_PERMISSIONS } from "@axora24/contracts";
import type {
  CrmAccountView,
  CrmAccount360View,
  CrmActivityView,
  CrmAssigneeView,
  CrmContactView,
  CrmDashboardView,
  CrmLeadView,
  CrmOpportunityView,
  CrmNextActionView,
  CrmPipelineStageView,
  CrmPage,
} from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import {
  boundedInteger,
  assertFields,
  currencyCode,
  decimalAmount,
  enumValue,
  optionalDate,
  optionalString,
  optionalEmail,
  optionalWebsite,
  expectedVersion,
  strictBoolean,
  requiredString,
  type ConvertLeadDto,
  type CreateAccountDto,
  type CreateActivityDto,
  type CreateContactDto,
  type CreateLeadDto,
  type CreateOpportunityDto,
  type CreateNextActionDto,
  type CreatePipelineStageDto,
  type MoveOpportunityStageDto,
  type UpdateLeadStatusDto,
  type UpdateAccountDto,
  type UpdateContactDto,
  type UpdateNextActionDto,
  type VersionDto,
  type DirectoryQueryDto,
  type ActivityQueryDto,
  type NextActionQueryDto,
  nextActionDueAt,
  nextActionFilter,
  nextActionPriority,
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
  "NEXT_ACTION_CREATED",
  "NEXT_ACTION_UPDATED",
  "NEXT_ACTION_COMPLETED",
  "NEXT_ACTION_CANCELLED",
] as const;
const RELATED_TYPES = ["Lead", "Opportunity", "Account", "Contact"] as const;
const ACCOUNT_FIELDS = ["companyId", "name", "industry", "city", "country", "website", "phone", "email"] as const;
const CONTACT_FIELDS = ["companyId", "accountId", "fullName", "email", "phone", "jobTitle", "isPrimary"] as const;
const MANUAL_ACTIVITY_TYPES = ["NOTE", "CALL", "MEETING", "EMAIL", "TASK"] as const;
const NEXT_ACTION_FIELDS = ["companyId", "accountId", "title", "details", "dueAt", "priority", "assigneeUserId"] as const;
const NEXT_ACTION_UPDATE_FIELDS = ["companyId", "expectedVersion", "title", "details", "dueAt", "priority", "assigneeUserId"] as const;

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
      where: { ...scope, archivedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return accounts.map(toAccountView);
  }

  async pageAccounts(scope: CompanyScope, query: DirectoryQueryDto): Promise<CrmPage<CrmAccountView>> {
    const paging = pageInput(query);
    const where: Prisma.CrmAccountWhereInput = { ...scope, ...archiveWhere(query.archived) };
    if (paging.q) where.OR = ["name", "industry", "city", "country", "email", "phone"].map((key) => ({ [key]: { contains: paging.q, mode: "insensitive" } }));
    const [total, accounts] = await this.prisma.$transaction([
      this.prisma.crmAccount.count({ where }),
      this.prisma.crmAccount.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: paging.skip, take: paging.pageSize }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return pageResult(accounts.map(toAccountView), total, paging);
  }

  async getAccount(scope: CompanyScope, id: string): Promise<CrmAccountView> {
    return toAccountView(await this.accountInScope(this.prisma, scope, id));
  }

  async getAccount360(scope: CompanyScope, id: string, permissions: Set<string>): Promise<CrmAccount360View> {
    const account = await this.accountInScope(this.prisma, scope, id);
    const canReadContacts = permissions.has(CRM_PERMISSIONS.CONTACT_READ);
    const canReadOpportunities = permissions.has(CRM_PERMISSIONS.OPPORTUNITY_READ);
    const canReadActions = permissions.has(CRM_PERMISSIONS.NEXT_ACTION_READ);
    const canReadTimeline = permissions.has(CRM_PERMISSIONS.ACTIVITY_READ);

    const result = await this.prisma.$transaction(async (tx) => {
      const [contacts, opportunities, nextActions, relatedContacts, relatedOpportunities, relatedLeads] = await Promise.all([
        canReadContacts
          ? tx.crmContact.findMany({ where: { ...scope, accountId: id, archivedAt: null }, orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }, { id: "asc" }] })
          : Promise.resolve([]),
        canReadOpportunities
          ? tx.crmOpportunity.findMany({ where: { ...scope, accountId: id }, include: { stage: true, account: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
          : Promise.resolve([]),
        canReadActions
          ? tx.crmNextAction.findMany({ where: { ...scope, accountId: id }, include: { assignee: { select: { fullName: true } } }, orderBy: [{ status: "asc" }, { dueAt: "asc" }, { id: "asc" }] })
          : Promise.resolve([]),
        canReadTimeline ? tx.crmContact.findMany({ where: { ...scope, accountId: id }, select: { id: true } }) : Promise.resolve([]),
        canReadTimeline ? tx.crmOpportunity.findMany({ where: { ...scope, accountId: id }, select: { id: true } }) : Promise.resolve([]),
        canReadTimeline ? tx.crmLead.findMany({ where: { ...scope, accountId: id }, select: { id: true } }) : Promise.resolve([]),
      ]);
      const timeline = canReadTimeline
        ? await tx.crmActivity.findMany({
          where: {
            ...scope,
            OR: [
              { relatedType: "Account", relatedId: id },
              { relatedType: "Contact", relatedId: { in: relatedContacts.map((item) => item.id) } },
              { relatedType: "Opportunity", relatedId: { in: relatedOpportunities.map((item) => item.id) } },
              { relatedType: "Lead", relatedId: { in: relatedLeads.map((item) => item.id) } },
            ],
          },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: 200,
        })
        : [];
      return { contacts, opportunities, nextActions, timeline };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    return {
      account: toAccountView(account),
      contacts: { available: canReadContacts, items: result.contacts.map(toContactView) },
      opportunities: { available: canReadOpportunities, items: result.opportunities.map(toOpportunityView) },
      nextActions: { available: canReadActions, items: result.nextActions.map(toNextActionView) },
      timeline: { available: canReadTimeline, items: result.timeline.map(toActivityView) },
    };
  }

  async getAccountTimeline(scope: CompanyScope, id: string): Promise<CrmActivityView[]> {
    const activities = await this.prisma.$transaction(async (tx) => {
      await this.accountInScope(tx, scope, id);
      const [contacts, opportunities, leads] = await Promise.all([
        tx.crmContact.findMany({ where: { ...scope, accountId: id }, select: { id: true } }),
        tx.crmOpportunity.findMany({ where: { ...scope, accountId: id }, select: { id: true } }),
        tx.crmLead.findMany({ where: { ...scope, accountId: id }, select: { id: true } }),
      ]);
      return tx.crmActivity.findMany({
        where: {
          ...scope,
          OR: [
            { relatedType: "Account", relatedId: id },
            { relatedType: "Contact", relatedId: { in: contacts.map((item) => item.id) } },
            { relatedType: "Opportunity", relatedId: { in: opportunities.map((item) => item.id) } },
            { relatedType: "Lead", relatedId: { in: leads.map((item) => item.id) } },
          ],
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 200,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return activities.map(toActivityView);
  }

  async createAccount(scope: CompanyScope, input: CreateAccountDto, actorUserId: string): Promise<CrmAccountView> {
    assertFields(input, ACCOUNT_FIELDS);
    const data = accountInput(input, true);
    const account = await this.prisma.$transaction(async (tx) => {
      await this.lockCompany(tx, scope);
      await this.uniqueAccountName(tx, scope, data.name!);
      const created = await tx.crmAccount.create({ data: { ...scope, ...data, name: data.name!, ownerUserId: actorUserId } });
      await this.directoryAudit(tx, scope, actorUserId, "Account", created.id, "created", created.version);
      return created;
    });
    return toAccountView(account);
  }

  async updateAccount(scope: CompanyScope, id: string, input: UpdateAccountDto, actorUserId: string): Promise<CrmAccountView> {
    assertFields(input, [...ACCOUNT_FIELDS, "expectedVersion"]);
    const version = expectedVersion(input.expectedVersion);
    const data = accountInput(input, false);
    if (!Object.keys(data).length) throw new BadRequestException("Provide at least one account field to update");
    const account = await this.prisma.$transaction(async (tx) => {
      await this.lockCompany(tx, scope);
      const current = await this.lockAccount(tx, scope, id);
      checkVersion(current.version, version);
      if (current.archivedAt) throw new ConflictException("Restore the account before editing it");
      if (data.name) await this.uniqueAccountName(tx, scope, data.name, id);
      const updated = await tx.crmAccount.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.directoryAudit(tx, scope, actorUserId, "Account", id, "updated", updated.version, Object.keys(data));
      return updated;
    });
    return toAccountView(account);
  }

  async archiveAccount(scope: CompanyScope, id: string, input: VersionDto, actorUserId: string, restore = false): Promise<CrmAccountView> {
    assertFields(input, ["companyId", "expectedVersion"]);
    const version = expectedVersion(input.expectedVersion);
    const account = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAccount(tx, scope, id);
      checkVersion(current.version, version);
      if (restore ? !current.archivedAt : !!current.archivedAt) throw new ConflictException(restore ? "Account is already active" : "Account is already archived");
      if (!restore) {
        const openActions = await tx.crmNextAction.count({ where: { ...scope, accountId: id, status: "OPEN" } });
        if (openActions > 0) throw new ConflictException("An account with open next actions cannot be archived");
      }
      const updated = await tx.crmAccount.update({ where: { id }, data: { archivedAt: restore ? null : new Date(), version: { increment: 1 } } });
      await this.directoryAudit(tx, scope, actorUserId, "Account", id, restore ? "restored" : "archived", updated.version);
      return updated;
    });
    return toAccountView(account);
  }

  async listContacts(scope: CompanyScope): Promise<CrmContactView[]> {
    const contacts = await this.prisma.crmContact.findMany({
      where: { ...scope, archivedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return contacts.map(toContactView);
  }

  async pageContacts(scope: CompanyScope, query: DirectoryQueryDto): Promise<CrmPage<CrmContactView>> {
    const paging = pageInput(query);
    const where: Prisma.CrmContactWhereInput = { ...scope, ...archiveWhere(query.archived) };
    if (query.accountId) {
      await this.accountInScope(this.prisma, scope, requiredString(query.accountId, "accountId"));
      where.accountId = query.accountId;
    }
    if (paging.q) where.OR = ["fullName", "email", "phone", "jobTitle"].map((key) => ({ [key]: { contains: paging.q, mode: "insensitive" } }));
    const [total, contacts] = await this.prisma.$transaction([
      this.prisma.crmContact.count({ where }),
      this.prisma.crmContact.findMany({ where, orderBy: [{ fullName: "asc" }, { id: "asc" }], skip: paging.skip, take: paging.pageSize }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return pageResult(contacts.map(toContactView), total, paging);
  }

  async getContact(scope: CompanyScope, id: string): Promise<CrmContactView> {
    return toContactView(await this.contactInScope(this.prisma, scope, id));
  }

  async createContact(scope: CompanyScope, input: CreateContactDto, actorUserId: string): Promise<CrmContactView> {
    assertFields(input, CONTACT_FIELDS);
    const data = contactInput(input, true);
    const contact = await this.prisma.$transaction(async (tx) => {
      if (data.accountId) await this.lockActiveAccount(tx, scope, data.accountId);
      await this.checkPrimaryContact(tx, scope, data.accountId ?? null, data.isPrimary ?? false);
      const created = await tx.crmContact.create({ data: { ...scope, ...data, fullName: data.fullName! } });
      await this.directoryAudit(tx, scope, actorUserId, "Contact", created.id, "created", created.version);
      return created;
    });
    return toContactView(contact);
  }

  async updateContact(scope: CompanyScope, id: string, input: UpdateContactDto, actorUserId: string): Promise<CrmContactView> {
    assertFields(input, [...CONTACT_FIELDS, "expectedVersion"]);
    const version = expectedVersion(input.expectedVersion);
    const data = contactInput(input, false);
    if (!Object.keys(data).length) throw new BadRequestException("Provide at least one contact field to update");
    const snapshot = await this.contactInScope(this.prisma, scope, id);
    checkVersion(snapshot.version, version);
    const contact = await this.prisma.$transaction(async (tx) => {
      // Account locks precede contact locks, and are sorted when reassigning.
      for (const accountId of [...new Set([snapshot.accountId, data.accountId].filter((value): value is string => !!value))].sort()) await this.lockAccount(tx, scope, accountId);
      const current = await this.lockContact(tx, scope, id);
      checkVersion(current.version, version);
      if (current.archivedAt) throw new ConflictException("Restore the contact before editing it");
      const accountId = data.accountId === undefined ? current.accountId : data.accountId;
      if (accountId) await this.lockActiveAccount(tx, scope, accountId);
      await this.checkPrimaryContact(tx, scope, accountId, data.isPrimary ?? current.isPrimary, id);
      const updated = await tx.crmContact.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.directoryAudit(tx, scope, actorUserId, "Contact", id, "updated", updated.version, Object.keys(data));
      return updated;
    });
    return toContactView(contact);
  }

  async archiveContact(scope: CompanyScope, id: string, input: VersionDto, actorUserId: string, restore = false): Promise<CrmContactView> {
    assertFields(input, ["companyId", "expectedVersion"]);
    const version = expectedVersion(input.expectedVersion);
    const snapshot = await this.contactInScope(this.prisma, scope, id);
    checkVersion(snapshot.version, version);
    const contact = await this.prisma.$transaction(async (tx) => {
      if (snapshot.accountId) await this.lockAccount(tx, scope, snapshot.accountId);
      const current = await this.lockContact(tx, scope, id);
      checkVersion(current.version, version);
      if (restore ? !current.archivedAt : !!current.archivedAt) throw new ConflictException(restore ? "Contact is already active" : "Contact is already archived");
      if (restore) {
        if (current.accountId) await this.lockActiveAccount(tx, scope, current.accountId);
        await this.checkPrimaryContact(tx, scope, current.accountId, current.isPrimary, id);
      }
      const updated = await tx.crmContact.update({ where: { id }, data: { archivedAt: restore ? null : new Date(), version: { increment: 1 } } });
      await this.directoryAudit(tx, scope, actorUserId, "Contact", id, restore ? "restored" : "archived", updated.version);
      return updated;
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
    const lead = await this.prisma.$transaction((tx) => this.insertLead(tx, scope, input, actorUserId));
    return toLeadView(lead);
  }

  /**
   * Creation d'un prospect dans une transaction fournie (memes regles pour
   * l'interface, l'API publique et les webhooks entrants).
   */
  async insertLead(tx: Prisma.TransactionClient, scope: CompanyScope, input: CreateLeadDto, actorUserId: string) {
    const contactName = requiredString(input.contactName, "contactName", 180);
    const companyName = requiredString(input.companyName, "companyName", 180);
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
  }

  async updateLeadStatus(
    scope: CompanyScope,
    leadId: string,
    input: UpdateLeadStatusDto,
    actorUserId: string,
  ): Promise<CrmLeadView> {
    const status = enumValue(input.status, LEAD_STATUSES, "status");
    if (status === "CONVERTED") {
      throw new BadRequestException("Use POST /crm/leads/:id/convert to convert a lead");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const lead = await this.lockLead(tx, scope, leadId);
      if (lead.status === "CONVERTED") {
        throw new BadRequestException("A converted lead can no longer change status");
      }
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
    assertFields(input, ["companyId", "opportunityName", "amount", "currency", "stageId", "expectedCloseDate", "accountId", "contactId"]);
    const selectedAccountId = optionalString(input.accountId, "accountId");
    const selectedContactId = optionalString(input.contactId, "contactId");
    if (selectedContactId && !selectedAccountId) throw new BadRequestException("accountId is required with contactId");
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
    if (stage.isWon || stage.isLost) {
      throw new BadRequestException("A new opportunity must start in an open pipeline stage");
    }

    const opportunity = await this.prisma.$transaction(async (tx) => {
      // A row lock serializes conversion and status transitions. A plain read
      // at READ COMMITTED does not stop two simultaneous conversions.
      const locked = await this.lockLead(tx, scope, lead.id);
      if (locked.status === "CONVERTED") {
        throw new BadRequestException("Lead already converted");
      }
      if (locked.status === "DISQUALIFIED") {
        throw new BadRequestException("A disqualified lead cannot be converted");
      }

      // Serialize reuse/creation of the unique customer name across leads.
      await this.lockCompany(tx, scope);
      let account;
      if (selectedAccountId) account = await this.lockActiveAccount(tx, scope, selectedAccountId);
      else {
        const existing = await tx.crmAccount.findFirst({ where: { ...scope, name: locked.companyName } });
        if (existing) account = await this.lockActiveAccount(tx, scope, existing.id);
        else {
          account = await tx.crmAccount.create({ data: { ...scope, name: locked.companyName, email: locked.email, phone: locked.phone, ownerUserId: actorUserId } });
          await this.directoryAudit(tx, scope, actorUserId, "Account", account.id, "created", account.version);
        }
      }

      let contact;
      if (selectedContactId) {
        contact = await this.lockContact(tx, scope, selectedContactId);
        if (contact.archivedAt) throw new ConflictException("Restore the archived contact before using it");
        if (contact.accountId !== account.id) throw new BadRequestException("The contact must belong to the selected account");
      } else {
        const primary = await tx.crmContact.findFirst({ where: { ...scope, accountId: account.id, isPrimary: true, archivedAt: null }, select: { id: true } });
        contact = await tx.crmContact.create({ data: { ...scope, accountId: account.id, fullName: locked.contactName,
          email: locked.email, phone: locked.phone, isPrimary: !primary } });
        await this.directoryAudit(tx, scope, actorUserId, "Contact", contact.id, "created", contact.version);
      }

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

      await tx.auditLog.create({ data: { organizationId: scope.organizationId, actorUserId, action: "crm.lead.converted",
        resourceType: "CrmLead", resourceId: lead.id, metadata: { companyId: scope.companyId, opportunityId: created.id, accountId: account.id, contactId: contact.id } } });

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

    if (contactId && !accountId) throw new BadRequestException("accountId is required with contactId");

    const stage = input.stageId
      ? await this.findStageInScope(scope, input.stageId)
      : await this.firstOpenStage(scope);
    if (stage.isWon || stage.isLost) {
      throw new BadRequestException("A new opportunity must start in an open pipeline stage");
    }

    const opportunity = await this.prisma.$transaction(async (tx) => {
      if (accountId) await this.lockActiveAccount(tx, scope, accountId);
      if (contactId) {
        const contact = await this.lockContact(tx, scope, contactId);
        if (contact.archivedAt) throw new ConflictException("Restore the archived contact before using it");
        if (contact.accountId !== accountId) throw new BadRequestException("The contact must belong to the selected account");
      }
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
    const stage = await this.findStageInScope(scope, requiredString(input.stageId, "stageId"));
    const status = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";

    const updated = await this.prisma.$transaction(async (tx) => {
      const opportunity = await this.lockOpportunity(tx, scope, opportunityId);
      if (opportunity.status !== "OPEN") {
        throw new BadRequestException("A closed opportunity can no longer change stage");
      }
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
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 200,
    });
    return activities.map(toActivityView);
  }

  async pageActivities(scope: CompanyScope, query: ActivityQueryDto): Promise<CrmPage<CrmActivityView>> {
    const paging = pageInput(query);
    const where: Prisma.CrmActivityWhereInput = { ...scope };
    if (query.relatedType) where.relatedType = canonicalRelatedType(query.relatedType);
    if (query.relatedId) {
      if (!query.relatedType) throw new BadRequestException("relatedType is required with relatedId");
      const id = requiredString(query.relatedId, "relatedId");
      await this.assertRelatedInScope(scope, canonicalRelatedType(query.relatedType), id);
      where.relatedId = id;
    }
    if (query.type) where.type = enumValue(query.type, ACTIVITY_TYPES, "type");
    if (paging.q) where.OR = [{ subject: { contains: paging.q, mode: "insensitive" } }, { body: { contains: paging.q, mode: "insensitive" } }];
    const [total, activities] = await this.prisma.$transaction([
      this.prisma.crmActivity.count({ where }),
      this.prisma.crmActivity.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: paging.skip, take: paging.pageSize }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return pageResult(activities.map(toActivityView), total, paging);
  }

  async createActivity(
    scope: CompanyScope,
    input: CreateActivityDto,
    actorUserId: string,
  ): Promise<CrmActivityView> {
    assertFields(input, ["companyId", "type", "subject", "body", "relatedType", "relatedId"]);
    const type = enumValue(input.type, MANUAL_ACTIVITY_TYPES, "type");
    const subject = requiredString(input.subject, "subject", 180);
    const relatedType = canonicalRelatedType(requiredString(input.relatedType, "relatedType", 40));
    const relatedId = requiredString(input.relatedId, "relatedId");

    // L'entite reliee doit appartenir au meme perimetre : sans ce controle,
    // un client pourrait greffer un historique sur un enregistrement d'un
    // autre tenant en devinant son identifiant.
    await this.assertRelatedInScope(scope, relatedType, relatedId);

    const activity = await this.prisma.$transaction(async (tx) => {
      const created = await tx.crmActivity.create({
        data: { ...scope, type, subject, body: optionalString(input.body, "body", 4000), relatedType, relatedId, actorUserId },
      });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, actorUserId, action: "crm.activity.created",
        resourceType: "CrmActivity", resourceId: created.id, metadata: { companyId: scope.companyId, relatedType, relatedId, type } } });
      return created;
    });
    return toActivityView(activity);
  }

  // -------------------------------------------------------------------------
  // Prochaines actions (mutables, avec historique append-only)
  // -------------------------------------------------------------------------

  async listAssignees(scope: CompanyScope): Promise<CrmAssigneeView[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; fullName: string }>>`
      SELECT u."id", u."fullName"
      FROM "users" u
      JOIN "company_memberships" cm ON cm."userId" = u."id"
      WHERE u."organizationId" = ${scope.organizationId}
        AND u."isActive" = true
        AND cm."companyId" = ${scope.companyId}
      ORDER BY u."fullName" ASC, u."id" ASC
    `;
    return rows;
  }

  async listNextActions(scope: CompanyScope, query: NextActionQueryDto): Promise<CrmNextActionView[]> {
    assertFields(query, ["companyId", "accountId", "filter"]);
    const filter = nextActionFilter(query.filter);
    const where: Prisma.CrmNextActionWhereInput = { ...scope };
    if (query.accountId) {
      const accountId = requiredString(query.accountId, "accountId");
      await this.accountInScope(this.prisma, scope, accountId);
      where.accountId = accountId;
    }
    Object.assign(where, nextActionDateWindow(filter, new Date()));
    const actions = await this.prisma.crmNextAction.findMany({
      where,
      include: { assignee: { select: { fullName: true } } },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { priority: "desc" }, { id: "asc" }],
      take: 500,
    });
    return actions.map(toNextActionView);
  }

  async createNextAction(scope: CompanyScope, input: CreateNextActionDto, actorUserId: string): Promise<CrmNextActionView> {
    assertFields(input, NEXT_ACTION_FIELDS);
    const accountId = requiredString(input.accountId, "accountId");
    const title = requiredString(input.title, "title", 200);
    const details = optionalString(input.details, "details", 4000);
    const dueAt = nextActionDueAt(input.dueAt);
    const priority = nextActionPriority(input.priority);
    const assigneeUserId = requiredString(input.assigneeUserId, "assigneeUserId");
    const action = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveAccount(tx, scope, accountId);
      await this.activeAssignee(tx, scope, assigneeUserId);
      const created = await tx.crmNextAction.create({
        data: { ...scope, accountId, title, details, dueAt, priority, assigneeUserId, createdByUserId: actorUserId, updatedByUserId: actorUserId },
        include: { assignee: { select: { fullName: true } } },
      });
      await this.nextActionEvent(tx, scope, actorUserId, created, "created");
      return created;
    });
    return toNextActionView(action);
  }

  async updateNextAction(scope: CompanyScope, id: string, input: UpdateNextActionDto, actorUserId: string): Promise<CrmNextActionView> {
    assertFields(input, NEXT_ACTION_UPDATE_FIELDS);
    const version = expectedVersion(input.expectedVersion);
    const data: { title?: string; details?: string | null; dueAt?: Date;
      priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; assigneeUserId?: string } = {};
    if (input.title !== undefined) data.title = requiredString(input.title, "title", 200);
    if (input.details !== undefined) data.details = optionalString(input.details, "details", 4000);
    if (input.dueAt !== undefined) data.dueAt = nextActionDueAt(input.dueAt);
    if (input.priority !== undefined) data.priority = nextActionPriority(input.priority);
    if (input.assigneeUserId !== undefined) data.assigneeUserId = requiredString(input.assigneeUserId, "assigneeUserId");
    const fields = Object.keys(data);
    if (!fields.length) throw new BadRequestException("Provide at least one next action field to update");
    const action = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockNextAction(tx, scope, id);
      checkVersion(current.version, version);
      if (current.status !== "OPEN") throw new ConflictException("Only an open next action can be updated");
      if (typeof data.assigneeUserId === "string") await this.activeAssignee(tx, scope, data.assigneeUserId);
      const updated = await tx.crmNextAction.update({
        where: { id },
        data: { ...data, updatedByUserId: actorUserId, version: { increment: 1 } },
        include: { assignee: { select: { fullName: true } } },
      });
      await this.nextActionEvent(tx, scope, actorUserId, updated, "updated", fields);
      return updated;
    });
    return toNextActionView(action);
  }

  async transitionNextAction(scope: CompanyScope, id: string, input: VersionDto, actorUserId: string,
    transition: "completed" | "cancelled"): Promise<CrmNextActionView> {
    assertFields(input, ["companyId", "expectedVersion"]);
    const version = expectedVersion(input.expectedVersion);
    const action = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockNextAction(tx, scope, id);
      checkVersion(current.version, version);
      if (current.status !== "OPEN") {
        if (transition === "completed") throw new ConflictException("Only an open next action can be completed");
        throw new ConflictException("Only an open next action can be cancelled");
      }
      const now = new Date();
      const updated = await tx.crmNextAction.update({
        where: { id },
        data: transition === "completed"
          ? { status: "COMPLETED", completedAt: now, updatedByUserId: actorUserId, version: { increment: 1 } }
          : { status: "CANCELLED", cancelledAt: now, updatedByUserId: actorUserId, version: { increment: 1 } },
        include: { assignee: { select: { fullName: true } } },
      });
      await this.nextActionEvent(tx, scope, actorUserId, updated, transition);
      return updated;
    });
    return toNextActionView(action);
  }

  // -------------------------------------------------------------------------
  // Tableau de bord commercial — agregats calcules sur des donnees reelles
  // -------------------------------------------------------------------------

  async dashboard(scope: CompanyScope, permissions: Set<string> = new Set()): Promise<CrmDashboardView> {
    const where = { organizationId: scope.organizationId, companyId: scope.companyId };
    const leadRead = permissions.has(CRM_PERMISSIONS.LEAD_READ);

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
      wonOpportunities,
      company,
    ] = await this.prisma.$transaction(async (tx) => {
      const leads = leadRead ? await Promise.all([
        tx.crmLead.count({ where }),
        tx.crmLead.count({ where: { ...where, status: "CONVERTED" } }),
        tx.crmLead.count({ where: { ...where, status: "DISQUALIFIED" } }),
      ]) : [0, 0, 0] as const;
      const opportunities = await Promise.all([
        tx.crmOpportunity.count({ where }),
        tx.crmOpportunity.count({ where: { ...where, status: "OPEN" } }),
        tx.crmOpportunity.count({ where: { ...where, status: "WON" } }),
        tx.crmOpportunity.count({ where: { ...where, status: "LOST" } }),
        tx.crmPipelineStage.findMany({ where, orderBy: { position: "asc" } }),
        tx.crmOpportunity.findMany({ where: { ...where, status: "OPEN" }, select: { amount: true, currency: true, stageId: true } }),
        tx.crmOpportunity.findMany({ where: { ...where, status: "WON" }, select: { amount: true, currency: true } }),
        tx.company.findFirstOrThrow({ where: { id: scope.companyId, organizationId: scope.organizationId }, select: { currency: true } }),
      ]);
      return [...leads, ...opportunities] as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const perStage = new Map<string, { count: number }>();

    for (const opportunity of openOpportunities) {
      const bucket = perStage.get(opportunity.stageId) ?? {
        count: 0,
      };
      bucket.count += 1;
      perStage.set(opportunity.stageId, bucket);
    }

    // Won and open amounts share the same currency contract. A mixed total
    // has no financial meaning, even if it is labelled "MIXED" in the UI.
    const currencies = [...new Set([...openOpportunities, ...wonOpportunities]
      .map((opportunity) => opportunity.currency.trim()))].sort();
    const currencyBreakdown = currencies.map((currency) => {
      const currentOpen = openOpportunities.filter((opportunity) => opportunity.currency.trim() === currency);
      const currentWon = wonOpportunities.filter((opportunity) => opportunity.currency.trim() === currency);
      const stageValues = stages.map((stage) => {
        const items = currentOpen.filter((opportunity) => opportunity.stageId === stage.id);
        const value = items.reduce((total, opportunity) => total.plus(opportunity.amount), new Prisma.Decimal(0));
        return { stageId: stage.id, stageName: stage.name, position: stage.position, probability: stage.probability,
          opportunityCount: items.length, value: value.toFixed(2) };
      });
      const pipelineValue = currentOpen.reduce((total, opportunity) => total.plus(opportunity.amount), new Prisma.Decimal(0));
      const wonValue = currentWon.reduce((total, opportunity) => total.plus(opportunity.amount), new Prisma.Decimal(0));
      const weightedValue = stageValues.reduce((total, stage) => total.plus(new Prisma.Decimal(stage.value).times(stage.probability).div(100)), new Prisma.Decimal(0));
      return { currency, pipelineValue: pipelineValue.toFixed(2), wonValue: wonValue.toFixed(2),
        weightedPipelineValue: weightedValue.toFixed(2), stages: stageValues };
    });
    const mixed = currencyBreakdown.length > 1;
    const single = currencyBreakdown.length === 1 ? currencyBreakdown[0]! : null;
    const currency = mixed ? "MIXED" : single?.currency ?? company.currency.trim();

    return {
      companyId: scope.companyId,
      leads: {
        available: leadRead,
        total: leadRead ? leadsTotal : null,
        open: leadRead ? leadsTotal - leadsConverted - leadsDisqualified : null,
        converted: leadRead ? leadsConverted : null,
      },
      opportunities: {
        total: opportunitiesTotal,
        open: opportunitiesOpen,
        won: opportunitiesWon,
        lost: opportunitiesLost,
      },
      pipelineValue: mixed ? null : single?.pipelineValue ?? "0.00",
      wonValue: mixed ? null : single?.wonValue ?? "0.00",
      weightedPipelineValue: mixed ? null : single?.weightedPipelineValue ?? "0.00",
      currency,
      currencyBreakdown,
      stages: stages.map((stage) => {
        const bucket = perStage.get(stage.id);
        return {
          stageId: stage.id,
          stageName: stage.name,
          position: stage.position,
          probability: stage.probability,
          opportunityCount: bucket?.count ?? 0,
          value: mixed ? null : single?.stages.find((item) => item.stageId === stage.id)?.value ?? "0.00",
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Controles de perimetre
  // -------------------------------------------------------------------------

  private async lockCompany(tx: Prisma.TransactionClient, scope: CompanyScope) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "companies"
      WHERE "id" = ${scope.companyId} AND "organizationId" = ${scope.organizationId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Company not found");
  }

  private async accountInScope(tx: Prisma.TransactionClient, scope: CompanyScope, id: string) {
    const account = await tx.crmAccount.findFirst({ where: { id, ...scope } });
    if (!account) throw new NotFoundException("Account not found");
    return account;
  }

  private async contactInScope(tx: Prisma.TransactionClient, scope: CompanyScope, id: string) {
    const contact = await tx.crmContact.findFirst({ where: { id, ...scope } });
    if (!contact) throw new NotFoundException("Contact not found");
    return contact;
  }

  private async lockAccount(tx: Prisma.TransactionClient, scope: CompanyScope, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "crm_accounts"
      WHERE "id" = ${id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Account not found");
    return tx.crmAccount.findUniqueOrThrow({ where: { id } });
  }

  private async lockActiveAccount(tx: Prisma.TransactionClient, scope: CompanyScope, id: string) {
    const account = await this.lockAccount(tx, scope, id);
    if (account.archivedAt) throw new ConflictException("Restore the archived account before using it");
    return account;
  }

  private async lockContact(tx: Prisma.TransactionClient, scope: CompanyScope, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "crm_contacts"
      WHERE "id" = ${id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException("Contact not found");
    return tx.crmContact.findUniqueOrThrow({ where: { id } });
  }

  private async uniqueAccountName(tx: Prisma.TransactionClient, scope: CompanyScope, name: string, exceptId?: string) {
    const duplicate = await tx.crmAccount.findFirst({ where: { ...scope, name, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (duplicate) {
      const Exception = exceptId ? ConflictException : BadRequestException;
      throw new Exception("An account with this name already exists; restore it if archived");
    }
  }

  private async checkPrimaryContact(tx: Prisma.TransactionClient, scope: CompanyScope, accountId: string | null, primary: boolean, exceptId?: string) {
    if (!primary) return;
    if (!accountId) throw new BadRequestException("A primary contact must belong to an account");
    const duplicate = await tx.crmContact.findFirst({ where: { ...scope, accountId, isPrimary: true, archivedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (duplicate) throw new ConflictException("This account already has an active primary contact");
  }

  private async directoryAudit(tx: Prisma.TransactionClient, scope: CompanyScope, actorUserId: string,
    relatedType: "Account" | "Contact", id: string, action: "created" | "updated" | "archived" | "restored", version: number, fields: string[] = []) {
    const labels = { created: "créé", updated: "modifié", archived: "archivé", restored: "restauré" };
    await tx.crmActivity.create({ data: { ...scope, actorUserId, type: "NOTE", relatedType, relatedId: id,
      subject: `${relatedType === "Account" ? "Compte" : "Contact"} ${labels[action]}`,
      body: fields.length ? `Champs modifiés : ${fields.join(", ")}` : null } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, actorUserId,
      action: `crm.${relatedType.toLowerCase()}.${action}`, resourceType: `Crm${relatedType}`, resourceId: id,
      metadata: { companyId: scope.companyId, version, fields } } });
  }

  private async activeAssignee(tx: Prisma.TransactionClient, scope: CompanyScope, userId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; fullName: string }>>`
      SELECT u."id", u."fullName"
      FROM "users" u
      JOIN "company_memberships" cm ON cm."userId" = u."id"
      WHERE u."id" = ${userId}
        AND u."organizationId" = ${scope.organizationId}
        AND u."isActive" = true
        AND cm."companyId" = ${scope.companyId}
      FOR SHARE OF u, cm
    `;
    if (!rows.length) throw new BadRequestException("The assignee must be an active member of this company");
    return rows[0]!;
  }

  private async lockNextAction(tx: Prisma.TransactionClient, scope: CompanyScope, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "crm_next_actions"
      WHERE "id" = ${id} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("Next action not found");
    return tx.crmNextAction.findUniqueOrThrow({ where: { id } });
  }

  private async nextActionEvent(tx: Prisma.TransactionClient, scope: CompanyScope, actorUserId: string,
    action: { id: string; accountId: string; title: string; dueAt: Date; priority: string; status: string; assigneeUserId: string; version: number },
    event: "created" | "updated" | "completed" | "cancelled", fields: string[] = []) {
    const activityType = {
      created: "NEXT_ACTION_CREATED",
      updated: "NEXT_ACTION_UPDATED",
      completed: "NEXT_ACTION_COMPLETED",
      cancelled: "NEXT_ACTION_CANCELLED",
    } as const;
    const labels = { created: "créée", updated: "modifiée", completed: "terminée", cancelled: "annulée" };
    await tx.crmActivity.create({
      data: {
        ...scope,
        actorUserId,
        type: activityType[event],
        relatedType: "Account",
        relatedId: action.accountId,
        subject: `Prochaine action ${labels[event]}`,
        body: `${action.title} — ${action.dueAt.toISOString()}`,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: scope.organizationId,
        actorUserId,
        action: `crm.next_action.${event}`,
        resourceType: "CrmNextAction",
        resourceId: action.id,
        metadata: {
          companyId: scope.companyId,
          accountId: action.accountId,
          assigneeUserId: action.assigneeUserId,
          priority: action.priority,
          status: action.status,
          dueAt: action.dueAt.toISOString(),
          version: action.version,
          fields,
        },
      },
    });
  }

  private async lockLead(tx: Prisma.TransactionClient, scope: CompanyScope, leadId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "crm_leads"
      WHERE "id" = ${leadId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("Lead not found");
    return tx.crmLead.findUniqueOrThrow({ where: { id: leadId } });
  }

  private async lockOpportunity(tx: Prisma.TransactionClient, scope: CompanyScope, opportunityId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "crm_opportunities"
      WHERE "id" = ${opportunityId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException("Opportunity not found");
    return tx.crmOpportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { stage: true } });
  }

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

function checkVersion(current: number, expected: number): void {
  if (current !== expected) throw new ConflictException("This record was changed by another user. Reload it before saving.");
}

function utcDayStart(value: Date): Date {
  const result = new Date(value);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

export function nextActionDateWindow(filter: "all" | "overdue" | "today" | "next7days", now: Date): Prisma.CrmNextActionWhereInput {
  if (filter === "all") return {};
  const today = utcDayStart(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const afterSevenDays = new Date(today.getTime() + 7 * 86_400_000);
  if (filter === "overdue") return { status: "OPEN", dueAt: { lt: now } };
  if (filter === "today") return { status: "OPEN", dueAt: { gte: today, lt: tomorrow } };
  return { status: "OPEN", dueAt: { gte: today, lt: afterSevenDays } };
}

function archiveWhere(value?: string): { archivedAt?: null | { not: null } } {
  if (value === undefined || value === "" || value === "false") return { archivedAt: null };
  if (value === "true") return { archivedAt: { not: null } };
  if (value === "all") return {};
  throw new BadRequestException("archived must be false, true or all");
}

function pageInput(query: DirectoryQueryDto | ActivityQueryDto) {
  const page = boundedInteger(query.page, "page", 1, 1_000_000, 1);
  const pageSize = boundedInteger(query.pageSize, "pageSize", 1, 100, 20);
  return { page, pageSize, skip: (page - 1) * pageSize, q: optionalString(query.q, "q", 180) };
}

function pageResult<T>(items: T[], total: number, paging: { page: number; pageSize: number }): CrmPage<T> {
  return { items, total, page: paging.page, pageSize: paging.pageSize, totalPages: Math.ceil(total / paging.pageSize) };
}

function accountInput(input: CreateAccountDto | UpdateAccountDto, create: boolean) {
  const data: { name?: string; industry?: string | null; city?: string | null; country?: string | null;
    website?: string | null; phone?: string | null; email?: string | null } = {};
  if (create || input.name !== undefined) data.name = requiredString(input.name, "name", 180);
  for (const key of ["industry", "city", "country"] as const) if (create || input[key] !== undefined) data[key] = optionalString(input[key], key, 120);
  if (create || input.website !== undefined) data.website = optionalWebsite(input.website);
  if (create || input.phone !== undefined) data.phone = optionalString(input.phone, "phone", 40);
  if (create || input.email !== undefined) data.email = optionalEmail(input.email);
  return data;
}

function contactInput(input: CreateContactDto | UpdateContactDto, create: boolean) {
  const data: { fullName?: string; accountId?: string | null; email?: string | null; phone?: string | null;
    jobTitle?: string | null; isPrimary?: boolean } = {};
  if (create || input.fullName !== undefined) data.fullName = requiredString(input.fullName, "fullName", 180);
  if (create || input.accountId !== undefined) data.accountId = optionalString(input.accountId, "accountId");
  if (create || input.email !== undefined) data.email = optionalEmail(input.email);
  if (create || input.phone !== undefined) data.phone = optionalString(input.phone, "phone", 40);
  if (create || input.jobTitle !== undefined) data.jobTitle = optionalString(input.jobTitle, "jobTitle", 120);
  if (create || input.isPrimary !== undefined) data.isPrimary = strictBoolean(input.isPrimary, "isPrimary");
  return data;
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
  website: string | null;
  archivedAt: Date | null;
  version: number;
  updatedAt: Date;
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
    website: account.website,
    archivedAt: account.archivedAt?.toISOString() ?? null,
    version: account.version,
    updatedAt: account.updatedAt.toISOString(),
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
  archivedAt: Date | null;
  version: number;
  updatedAt: Date;
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
    archivedAt: contact.archivedAt?.toISOString() ?? null,
    version: contact.version,
    updatedAt: contact.updatedAt.toISOString(),
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

function toNextActionView(action: {
  id: string;
  companyId: string;
  accountId: string;
  title: string;
  details: string | null;
  dueAt: Date;
  priority: string;
  status: string;
  assigneeUserId: string;
  assignee: { fullName: string };
  createdByUserId: string;
  updatedByUserId: string;
  completedAt: Date | null;
  cancelledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): CrmNextActionView {
  return {
    id: action.id,
    companyId: action.companyId,
    accountId: action.accountId,
    title: action.title,
    details: action.details,
    dueAt: action.dueAt.toISOString(),
    priority: action.priority as CrmNextActionView["priority"],
    status: action.status as CrmNextActionView["status"],
    assigneeUserId: action.assigneeUserId,
    assigneeName: action.assignee.fullName,
    createdByUserId: action.createdByUserId,
    updatedByUserId: action.updatedByUserId,
    completedAt: action.completedAt?.toISOString() ?? null,
    cancelledAt: action.cancelledAt?.toISOString() ?? null,
    overdue: action.status === "OPEN" && action.dueAt.getTime() < Date.now(),
    version: action.version,
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
  };
}
