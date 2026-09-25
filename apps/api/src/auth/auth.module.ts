import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionGuard } from "./session.guard.js";
import { PermissionGuard } from "./permission.guard.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { AccountService } from "./account.service.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccountService, LoginThrottleService, SessionGuard, PermissionGuard],
  exports: [SessionGuard, PermissionGuard, LoginThrottleService],
})
export class AuthModule {}
