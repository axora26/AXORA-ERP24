import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { InvoiceSignatureView } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { InvoiceSignature } from "@axora24/database";
import { writeAudit } from "../common/audit.js";
import { PrismaService } from "../core/prisma.service.js";

type SignatureBody = { documentHash?: unknown };
type RevokeBody = { reason?: unknown };

/**
 * Internal, tamper-evident invoice signatures.
 *
 * This proves the exact invoice representation that AXORA signed. It is an
 * internal cryptographic signature and does not claim qualified eIDAS status;
 * a qualified signature provider can be attached later without changing the
 * immutable evidence model.
 */
@Injectable()
export class InvoiceSignatureService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: CompanyScope, invoiceId: string): Promise<InvoiceSignatureView[]> {
    const rows = await this.prisma.invoiceSignature.findMany({
      where: { organizationId: scope.organizationId, companyId: scope.companyId, invoiceId },
      orderBy: { signedAt: "desc" },
    });
    return rows.map((row) => this.view(row));
  }

  async sign(scope: CompanyScope, invoiceId: string, body: unknown, userId: string): Promise<InvoiceSignatureView> {
    const input = this.parseBody(body);
    const invoice = await this.prisma.customerInvoice.findFirst({
      where: { id: invoiceId, organizationId: scope.organizationId, companyId: scope.companyId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!invoice) throw new NotFoundException("Facture introuvable");
    if (invoice.status !== "ISSUED" && invoice.status !== "PARTIALLY_PAID" && invoice.status !== "PAID") {
      throw new BadRequestException("Seule une facture émise peut être signée");
    }

    const canonicalHash = this.hashInvoice(invoice);
    const documentHash = input.documentHash ?? canonicalHash;
    const signature = createHmac("sha256", this.signingSecret()).update(documentHash, "utf8").digest("hex");
    const existing = await this.prisma.invoiceSignature.findFirst({
      where: { companyId: scope.companyId, invoiceId, documentHash, status: "VALID" },
    });
    if (existing) return this.view(existing);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.invoiceSignature.create({
          data: {
            organizationId: scope.organizationId,
            companyId: scope.companyId,
            invoiceId: invoice.id,
            invoiceCode: invoice.code ?? invoice.id,
            documentHash,
            signature,
            algorithm: "HMAC-SHA256",
            signerUserId: userId,
          },
        });
        await writeAudit(tx, scope, userId, "finance.invoice.signed", "CustomerInvoice", invoice.id, {
          invoiceCode: invoice.code,
          documentHash,
          algorithm: "HMAC-SHA256",
          canonicalHash,
        });
        return row;
      });
      return this.view(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const row = await this.prisma.invoiceSignature.findFirstOrThrow({
          where: { companyId: scope.companyId, invoiceId, documentHash, status: "VALID" },
        });
        return this.view(row);
      }
      throw error;
    }
  }

  async revoke(scope: CompanyScope, invoiceId: string, signatureId: string, body: unknown, userId: string): Promise<InvoiceSignatureView> {
    const reason = this.parseReason(body);
    const current = await this.prisma.invoiceSignature.findFirst({
      where: { id: signatureId, invoiceId, organizationId: scope.organizationId, companyId: scope.companyId },
    });
    if (!current) throw new NotFoundException("Signature introuvable");
    if (current.status === "REVOKED") return this.view(current);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.invoiceSignature.update({
        where: { id: current.id },
        data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: userId, revokeReason: reason },
      });
      await writeAudit(tx, scope, userId, "finance.invoice.signature.revoked", "InvoiceSignature", current.id, {
        invoiceId,
        reason,
      });
      return updated;
    });
    return this.view(row);
  }

  async verify(scope: CompanyScope, invoiceId: string, signatureId: string): Promise<{ valid: boolean; documentHash: string; invoiceCode: string; algorithm: string; signedAt: string; status: string }> {
    const row = await this.prisma.invoiceSignature.findFirst({
      where: { id: signatureId, invoiceId, organizationId: scope.organizationId, companyId: scope.companyId },
    });
    if (!row) throw new NotFoundException("Signature introuvable");
    const expected = Buffer.from(createHmac("sha256", this.signingSecret()).update(row.documentHash, "utf8").digest("hex"));
    const received = Buffer.from(row.signature);
    const cryptographicallyValid = expected.length === received.length && timingSafeEqual(expected, received);
    return {
      valid: cryptographicallyValid && row.status === "VALID",
      documentHash: row.documentHash,
      invoiceCode: row.invoiceCode,
      algorithm: row.algorithm,
      signedAt: row.signedAt.toISOString(),
      status: row.status,
    };
  }

  private parseBody(body: unknown): { documentHash?: string } {
    if (body === undefined || body === null) return {};
    if (typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("Corps de signature invalide");
    const value = (body as SignatureBody).documentHash;
    if (value === undefined || value === null || value === "") return {};
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new BadRequestException("documentHash doit être un SHA-256 hexadécimal");
    return { documentHash: value.toLowerCase() };
  }

  private parseReason(body: unknown): string {
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as RevokeBody).reason !== "string") throw new BadRequestException("Un motif de révocation est requis");
    const raw = (body as RevokeBody).reason;
    if (typeof raw !== "string") throw new BadRequestException("Un motif de révocation est requis");
    const reason = raw.trim().slice(0, 500);
    if (reason.length < 3) throw new BadRequestException("Le motif de révocation est trop court");
    return reason;
  }

  private hashInvoice(invoice: { id: string; code: string | null; currency: string; issueDate: Date | null; dueDate: Date | null; status: string; subtotal: Prisma.Decimal; taxTotal: Prisma.Decimal; total: Prisma.Decimal; lines: Array<{ position: number; description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; taxRate: Prisma.Decimal; lineTotal: Prisma.Decimal; lineTax: Prisma.Decimal }> }): string {
    const canonical = {
      id: invoice.id,
      code: invoice.code,
      currency: invoice.currency.trim(),
      issueDate: invoice.issueDate?.toISOString() ?? null,
      dueDate: invoice.dueDate?.toISOString() ?? null,
      status: invoice.status,
      subtotal: invoice.subtotal.toString(),
      taxTotal: invoice.taxTotal.toString(),
      total: invoice.total.toString(),
      lines: invoice.lines.map((line) => ({ position: line.position, description: line.description, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString(), taxRate: line.taxRate.toString(), lineTotal: line.lineTotal.toString(), lineTax: line.lineTax.toString() })),
    };
    return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
  }

  private signingSecret(): string {
    return process.env.AXORA_INVOICE_SIGNING_SECRET ?? "axora-local-invoice-signing-key-change-in-production";
  }

  private view(row: InvoiceSignature): InvoiceSignatureView {
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      invoiceCode: row.invoiceCode,
      documentHash: row.documentHash,
      signature: row.signature,
      algorithm: "HMAC-SHA256",
      signerUserId: row.signerUserId,
      signedAt: row.signedAt.toISOString(),
      status: row.status,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedByUserId: row.revokedByUserId,
      revokeReason: row.revokeReason,
    };
  }
}
