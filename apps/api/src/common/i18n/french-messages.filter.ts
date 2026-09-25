import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Response } from "express";
import { HTTP_ERROR_LABELS, translateMessage } from "./translate.js";

/**
 * Filtre global : les messages d'erreur renvoyes aux clients sont en francais
 * (catalogue verifie par test). Le statut HTTP, la forme de la reponse et les
 * en-tetes deja poses (Retry-After...) sont conserves.
 */
@Catch(HttpException)
export class FrenchMessagesFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const raw = exception.getResponse();
    const payload: Record<string, unknown> = typeof raw === "string" ? { statusCode: status, message: raw } : { ...(raw as Record<string, unknown>) };
    const translate = (value: unknown) => (typeof value === "string" ? (translateMessage(value) ?? value) : value);
    payload.message = Array.isArray(payload.message) ? payload.message.map(translate) : translate(payload.message);
    if (typeof payload.error === "string") payload.error = HTTP_ERROR_LABELS[payload.error] ?? payload.error;
    response.status(status).json(payload);
  }
}
