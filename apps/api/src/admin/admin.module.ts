import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

/** INC-01 — Administration : utilisateurs, roles, entreprises, audit. */
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
