import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MepController } from "./mep.controller.js";
import { MepService } from "./mep.service.js";

/** INC-13 — MEP : systemes, equipements, notes de calcul verifiables. */
@Module({
  imports: [AuthModule],
  controllers: [MepController],
  providers: [MepService],
})
export class MepModule {}
