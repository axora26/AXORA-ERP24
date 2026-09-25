import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { PrismaService } from "../core/prisma.service.js";
import { normalizeIp } from "./api-key.js";

/**
 * Journal append-only des requetes de l'API publique authentifiees par cle
 * (y compris refus 403/429), ecrit a la fin de la reponse.
 */
@Injectable()
export class ApiRequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger("ApiRequestLog");

  constructor(private readonly prisma: PrismaService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const started = Date.now();
    response.on("finish", () => {
      const key = request.axoraApiKey;
      if (!key) return;
      void this.prisma.apiRequestLog
        .create({ data: { organizationId: key.organizationId, companyId: key.companyId, keyId: key.id, method: request.method, path: request.originalUrl.split("?")[0]!.slice(0, 300), status: response.statusCode, ip: normalizeIp(request.ip) || null, durationMs: Date.now() - started } })
        .catch((error: unknown) => this.logger.warn(`Journal API non ecrit : ${error instanceof Error ? error.message : String(error)}`));
    });
    next();
  }
}
