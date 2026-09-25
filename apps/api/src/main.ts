import "./config/load-env.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { applySecurityHeaders } from "./common/security-headers.js";

async function bootstrap(): Promise<void> {
  // rawBody : les webhooks entrants verifient leur signature sur le corps brut.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  applySecurityHeaders(app);
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3100",
    credentials: true,
  });
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`AXORA-ERP24 API demarree sur le port ${port}`);
}

bootstrap();
