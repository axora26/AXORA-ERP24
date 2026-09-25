import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { QhseController } from "./qhse.controller.js";
import { QhseService } from "./qhse.service.js";

/** INC-11 — QHSE : inspections, NCR, actions correctives, incidents, permis, causeries. */
@Module({
  imports: [AuthModule],
  controllers: [QhseController],
  providers: [QhseService],
})
export class QhseModule {}
