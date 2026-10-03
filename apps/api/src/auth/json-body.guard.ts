import { BadRequestException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Object-shaped JSON contracts are enforced before controller property access. */
@Injectable()
export class JsonBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const contentType = request.headers["content-type"] ?? "";
    // Incoming webhooks verify the raw-body signature before their own shape
    // validation; multipart bodies are populated later by the upload parser.
    if (/^\/(?:api\/v1\/)?public\/inbound\/[^/]+\/?$/.test(request.path) || /^multipart\/form-data(?:\s*;|$)/i.test(contentType)) return true;
    const hasBody = Boolean(request.headers["content-length"] && request.headers["content-length"] !== "0") || Boolean(request.headers["transfer-encoding"]);
    if (request.body === undefined && !hasBody) {
      request.body = {};
      return true;
    }
    if (/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType) && (!request.body || typeof request.body !== "object" || Array.isArray(request.body))) throw new BadRequestException("JSON body must be an object");
    return true;
  }
}
