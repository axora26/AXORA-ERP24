import { Global, Module } from "@nestjs/common";
import { AutomationService } from "./automation.service.js";
import { WorkflowGate } from "./workflow-gate.service.js";
import { WorkflowService } from "./workflow.service.js";
import { NotificationsController, WorkflowController } from "./workflow.controller.js";

/** Global : tout module metier peut emettre des evenements et consulter la barriere d'approbation. */
@Global()
@Module({
  controllers: [WorkflowController, NotificationsController],
  providers: [AutomationService, WorkflowGate, WorkflowService],
  exports: [AutomationService, WorkflowGate],
})
export class WorkflowModule {}
