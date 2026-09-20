import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionGuard } from "./session.guard.js";
import { PermissionGuard } from "./permission.guard.js";
import { PrismaService } from "../core/prisma.service.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, PermissionGuard, PrismaService],
  exports: [SessionGuard, PermissionGuard],
})
export class AuthModule {}
