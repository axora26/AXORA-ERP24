import "./config/load-env.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { applySecurityHeaders } from "./common/security-headers.js";
import { trustedOrigins } from "./auth/origin.guard.js";

async function bootstrap(): Promise<void> {
  // rawBody : les webhooks entrants verifient leur signature sur le corps brut.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  applySecurityHeaders(app);
  app.use(cookieParser());
  app.enableCors({
    origin: trustedOrigins(),
    credentials: true,
  });
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? "127.0.0.1";
  await app.listen(port, host);
  console.log(`AXORA-ERP24 API demarree sur le port ${port}`);
}

bootstrap();
