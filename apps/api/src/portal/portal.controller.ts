import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { PORTAL_COOKIE, PortalSessionGuard, Principal, type PortalContext } from "./portal-session.guard.js";
import { PortalService } from "./portal.service.js";

function setPortalCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(PORTAL_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", expires: expiresAt, path: "/" });
}

/**
 * INC-20 — API du plan d'identite EXTERNE. Seules l'activation et la
 * connexion sont publiques ; tout le reste exige le cookie portail.
 */
@Controller("portal")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Post("auth/activate")
  @HttpCode(200)
  async activate(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.portal.activate(body, request.ip);
    setPortalCookie(response, result.token, result.expiresAt);
    return result.me;
  }

  @Post("auth/login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.portal.login(body, request.ip);
    setPortalCookie(response, result.token, result.expiresAt);
    return result.me;
  }

  @Post("auth/logout")
  @HttpCode(200)
  @UseGuards(PortalSessionGuard)
  async logout(@Principal() principal: PortalContext, @Res({ passthrough: true }) response: Response) {
    await this.portal.logout(principal);
    response.clearCookie(PORTAL_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  @UseGuards(PortalSessionGuard)
  me(@Principal() principal: PortalContext) {
    return this.portal.me(principal.id);
  }

  @Get("home")
  @UseGuards(PortalSessionGuard)
  home(@Principal() principal: PortalContext) {
    return this.portal.home(principal);
  }

  @Post("orders/:id/acknowledge")
  @HttpCode(200)
  @UseGuards(PortalSessionGuard)
  acknowledge(@Principal() principal: PortalContext, @Param("id") id: string, @Body() body: unknown) {
    return this.portal.acknowledgeOrder(principal, id, body);
  }

  @Get("documents/:id/content")
  @UseGuards(PortalSessionGuard)
  async document(@Principal() principal: PortalContext, @Param("id") id: string, @Res() response: Response): Promise<void> {
    const { file, content } = await this.portal.documentContent(principal, id);
    const asciiName = file.originalName.replace(/[^\x20-\x7e]/g, "_");
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Length", String(content.length));
    response.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(content);
  }
}
