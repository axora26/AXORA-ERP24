import type { INestApplication } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/**
 * En-tetes de securite de l'API, appliques en production ET dans les tests
 * e2e (meme fonction) :
 * - aucune reponse d'API mise en cache (donnees soumises au controle d'acces) ;
 * - pas de detection de type MIME, pas d'affichage en cadre, aucun referent ;
 * - pas d'en-tete revelant le framework.
 */
export function applySecurityHeaders(app: INestApplication): void {
  const express = app.getHttpAdapter().getInstance() as { disable?: (setting: string) => void };
  express.disable?.("x-powered-by");
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    if (!response.getHeader("Cache-Control")) response.setHeader("Cache-Control", "no-store");
    next();
  });
}
