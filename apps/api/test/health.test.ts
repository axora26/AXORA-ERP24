import { describe, it, expect, beforeAll } from "vitest";
import { Test } from "@nestjs/testing";
import { HealthController } from "../src/health/health.controller.js";

describe("HealthController", () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it("returns status ok with a timestamp", () => {
    const result = controller.check();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("axora-erp24-api");
    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});
