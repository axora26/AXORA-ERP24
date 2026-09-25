import { Module } from "@nestjs/common";
import { CopilotController } from "./copilot.controller.js";
import { CopilotService } from "./copilot.service.js";

@Module({
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
