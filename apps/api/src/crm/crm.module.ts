import { Module } from "@nestjs/common";
import { CrmController } from "./crm.controller.js";
import { CrmService } from "./crm.service.js";
import { AuthModule } from "../auth/auth.module.js";

/**
 * Module CRM — INC-02 (prospects -> opportunites -> pipeline).
 * Reference : docs/foundation/06-product-backlog.md #INC-02.
 */
@Module({
  imports: [AuthModule],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
