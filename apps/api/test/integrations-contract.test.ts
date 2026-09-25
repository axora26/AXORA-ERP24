import { describe, expect, it } from "vitest";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { ALL_PERMISSIONS, CONNECTORS, PUBLIC_API_PERMISSIONS } from "@axora24/contracts";
import { OPENAPI_SPEC } from "../src/integrations/openapi.js";
import { PublicApiController } from "../src/integrations/public-api.controller.js";

describe("API publique — contrat documenté", () => {
  it("chaque route du contrôleur public est décrite dans l'OpenAPI avec sa permission", () => {
    const proto = PublicApiController.prototype as unknown as Record<string, unknown>;
    const routes = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== "constructor" && typeof proto[name] === "function" && Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined)
      .map((name) => {
        const handler = proto[name] as object;
        const path = `/public/${String(Reflect.getMetadata(PATH_METADATA, handler)).replace(/:([a-zA-Z]+)/g, "{$1}")}`;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]!.toLowerCase();
        const permission = Reflect.getMetadata("axora:api-permission", handler) as string;
        return { path, method, permission };
      });
    expect(routes.length).toBeGreaterThanOrEqual(8);
    const paths = OPENAPI_SPEC.paths as Record<string, Record<string, { "x-axora-permission": string | null }>>;
    for (const route of routes) {
      const documented = paths[route.path]?.[route.method];
      expect(documented, `${route.method.toUpperCase()} ${route.path} non documentée`).toBeDefined();
      expect(documented!["x-axora-permission"]).toBe(route.permission === "*" ? null : route.permission);
      if (route.permission !== "*") expect(PUBLIC_API_PERMISSIONS as readonly string[]).toContain(route.permission);
    }
  });

  it("chaque permission attribuable à une clé existe réellement dans le catalogue", () => {
    for (const permission of PUBLIC_API_PERMISSIONS) expect(Object.values(ALL_PERMISSIONS) as string[], permission).toContain(permission);
  });

  it("registre des connecteurs : jamais TESTED sans système externe réellement atteint", () => {
    for (const connector of CONNECTORS) {
      if (connector.externalReached === false) expect(connector.status, connector.key).not.toBe("TESTED");
      if (!connector.implemented) expect(connector.status, connector.key).toBe("NOT_IMPLEMENTED");
      if (connector.status === "TESTED") expect(connector.implemented && (connector.readTested || connector.writeTested)).toBe(true);
    }
    expect(new Set(CONNECTORS.map((connector) => connector.key)).size).toBe(CONNECTORS.length);
  });
});
