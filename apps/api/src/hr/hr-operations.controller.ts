import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { HR_PERMISSIONS as H } from "@axora24/contracts";
import { RequireAnyPermission, RequirePermission } from "../auth/require-permission.decorator.js";
import { CurrentUser, Scope, ScopedController } from "../common/scope.guard.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { ServiceCardService } from "./service-card.service.js";
import { PayrollPolicyService } from "./payroll-policy.service.js";
import { HrService } from "./hr.service.js";

@Controller("hr")
@ScopedController()
export class HrOperationsController {
  constructor(private readonly cards: ServiceCardService, private readonly policy: PayrollPolicyService, private readonly hr: HrService) {}
  @Get("employees/:id/service-cards")
  @RequirePermission(H.EMPLOYEE_READ)
  cardsList(@Scope() scope: CompanyScope, @Param("id") id: string) { return this.cards.list(scope, id); }
  @Get("employees/:id/service-card")
  @RequirePermission(H.CARD_MANAGE)
  cardDocument(@Scope() scope: CompanyScope, @Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) { return this.cards.document(scope, id, actor.id); }
  @Post("employees/:id/service-card")
  @RequirePermission(H.CARD_MANAGE)
  issueCard(@Scope() scope: CompanyScope, @Param("id") id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.cards.issue(scope, id, body, actor.id); }
  @Post("service-cards/:id/revoke")
  @RequirePermission(H.CARD_MANAGE)
  revokeCard(@Scope() scope: CompanyScope, @Param("id") id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.cards.revoke(scope, id, body, actor.id); }
  @Get("payroll-policy")
  @RequireAnyPermission(H.PAYROLL_READ, H.POLICY_MANAGE)
  readPolicy(@Scope() scope: CompanyScope) { return this.policy.get(scope); }
  @Patch("payroll-policy")
  @RequirePermission(H.POLICY_MANAGE)
  updatePolicy(@Scope() scope: CompanyScope, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.policy.update(scope, body, actor.id); }
  @Post("timesheets/:id/from-attendance")
  @RequirePermission(H.TIMESHEET_MANAGE)
  importAttendance(@Scope() scope: CompanyScope, @Param("id") id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.hr.importAttendance(scope, id, body, actor.id); }
}
