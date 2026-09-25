import { Global, Module } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service.js";
import { CompanyScopeService } from "./company-scope.service.js";
import { CompanyScopeGuard } from "./scope.guard.js";
import { NumberingService } from "./numbering.service.js";

/**
 * Services transverses partages par tous les modules.
 *
 * Global : une SEULE instance de PrismaService (donc un seul pool de
 * connexions PostgreSQL) pour toute l'application — auparavant chaque module
 * instanciait son propre client.
 */
@Global()
@Module({
  providers: [PrismaService, CompanyScopeService, CompanyScopeGuard, NumberingService],
  exports: [PrismaService, CompanyScopeService, CompanyScopeGuard, NumberingService],
})
export class CommonModule {}
