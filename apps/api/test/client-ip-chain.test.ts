import { NestFactory } from "@nestjs/core";
import { Controller, Get, Module, Req, type INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trustProxySetting } from "../src/config/trust-proxy.js";

/**
 * Chaine de production : client -> Caddy (172.x, reseau Docker) -> Next.js
 * (172.x) -> API. Caddy ajoute l'adresse du client a X-Forwarded-For et
 * Next.js relaie l'en-tete tel quel. Avec TRUST_PROXY="loopback, uniquelocal",
 * l'API (meme adaptateur Express qu'en production) doit retenir l'adresse
 * publique du client et ignorer une adresse usurpee placee en tete par lui.
 */
@Controller()
class EchoController {
  @Get("ip")
  ip(@Req() request: { ip?: string }) {
    return { ip: request.ip };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe("Adresse client derriere Caddy + Next.js", () => {
  let app: INestApplication;
  let base = "";

  beforeAll(async () => {
    app = await NestFactory.create(EchoModule, { logger: false });
    app.getHttpAdapter().getInstance().set("trust proxy", trustProxySetting({ TRUST_PROXY: "loopback, uniquelocal" }));
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const ipFor = async (forwardedFor: string) =>
    ((await (await fetch(`${base}/ip`, { headers: { "X-Forwarded-For": forwardedFor } })).json()) as { ip: string }).ip;

  it("retient l'adresse publique ajoutee par Caddy", async () => {
    expect(await ipFor("41.243.7.10, 172.18.0.4")).toBe("41.243.7.10");
  });

  it("ignore une adresse usurpee envoyee par le client", async () => {
    expect(await ipFor("10.0.0.1, 41.243.7.10, 172.18.0.4")).toBe("41.243.7.10");
    expect(await ipFor("8.8.8.8, 41.243.7.10")).toBe("41.243.7.10");
  });
});
