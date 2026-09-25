import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { Gateway, GatewayTokenGuard, type GatewayContext } from "./gateway-token.guard.js";
import { SmartIngestionService } from "./ingestion.service.js";

/**
 * API machine des passerelles GTB (jeton porteur, sans session) : envoi des
 * lectures, recuperation et acquit des consignes de leurs propres points.
 */
@Controller("smart/gateway")
@UseGuards(GatewayTokenGuard)
export class SmartGatewayController {
  constructor(private readonly ingestion: SmartIngestionService) {}

  @Post("readings")
  @HttpCode(200)
  readings(@Gateway() gateway: GatewayContext, @Body() body: unknown, @Req() request: Request) {
    return this.ingestion.ingest(gateway, body, request.ip);
  }

  @Get("setpoints")
  setpoints(@Gateway() gateway: GatewayContext) {
    return this.ingestion.pendingSetpoints(gateway);
  }

  @Post("setpoints/:id/ack")
  @HttpCode(200)
  acknowledge(@Gateway() gateway: GatewayContext, @Param("id") id: string, @Body() body: unknown) {
    return this.ingestion.acknowledgeSetpoint(gateway, id, body);
  }
}
