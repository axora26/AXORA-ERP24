import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FilesModule } from "../files/files.module.js";
import { BimController } from "./bim.controller.js";
import { BimService } from "./bim.service.js";

/** INC-14 — BIM / IFC : maquettes versionnees, elements, liaisons MEP, conflits. */
@Module({
  imports: [AuthModule, FilesModule],
  controllers: [BimController],
  providers: [BimService],
})
export class BimModule {}
