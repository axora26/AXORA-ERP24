import { Controller, Get } from "@nestjs/common";

/**
 * Endpoint de sante — utilise par le healthcheck Docker (docker-compose.dev.yml).
 * Volontairement hors du prefixe /api/v1 et sans authentification.
 */
@Controller("health")
export class HealthController {
  @Get()
  check(): { status: "ok"; service: string; timestamp: string } {
    return {
      status: "ok",
      service: "axora-erp24-api",
      timestamp: new Date().toISOString(),
    };
  }
}
