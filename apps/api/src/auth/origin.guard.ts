import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export function trustedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? "http://localhost:3100").split(",").map((origin) => origin.trim()).filter(Boolean);
}
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const origin = request.headers.origin;
    if (origin && !trustedOrigins().includes(origin)) throw new ForbiddenException("Untrusted request origin");
    if (request.headers["sec-fetch-site"] === "cross-site") throw new ForbiddenException("Cross-site request denied");
    const names = [process.env.SESSION_COOKIE_NAME ?? "axora_erp24_session", "axora_portal_session"];
    const usesSession = (request.headers.cookie ?? "").split(";").some((cookie) => names.some((name) => cookie.trim().startsWith(`${name}=`)));
    if (!usesSession) return true; // Server API calls and signed webhooks have no cookie dependency.
    const contentType = request.headers["content-type"] ?? "";
    const multipartUpload = request.method === "POST" && /^\/(?:api\/v1\/)?files\/?$/.test(request.path) && /^multipart\/form-data\s*;/i.test(contentType);
    const hasBody = Boolean(request.headers["content-length"] && request.headers["content-length"] !== "0") || Boolean(request.headers["transfer-encoding"]);
    if (hasBody && !/^application\/json(?:\s*;|$)/i.test(contentType) && !multipartUpload) throw new ForbiddenException("JSON content type required");
    return true;
  }
}
