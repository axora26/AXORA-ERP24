import { Body, Controller, Get, HttpException, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import type { LoginDto, RegisterOrganizationDto } from "./auth.dto.js";
import { SessionGuard } from "./session.guard.js";
import { AccountService } from "./account.service.js";
import { hashSessionToken } from "@axora24/security";
import { AllowMfaEnrollment } from "./allow-mfa-enrollment.decorator.js";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "axora_erp24_session";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly account: AccountService,
  ) {}

  /** Politique d'inscription publique : l'interface masque la creation d'espace si elle est fermee. */
  @Get("registration")
  registration() {
    return this.authService.registrationStatus();
  }

  @Post("register-organization")
  async registerOrganization(
    @Body() body: RegisterOrganizationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    let result;
    try {
      result = await this.authService.registerOrganization(body, { ipAddress: request.ip ?? request.socket.remoteAddress ?? "unknown", userAgent: request.get("user-agent") ?? "unknown" });
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        const details = error.getResponse() as { retryAfterSeconds?: number };
        response.setHeader("Retry-After", String(details.retryAfterSeconds ?? 900));
      }
      throw error;
    }
    setSessionCookie(response, result.plainToken, result.expiresAt);
    return { user: result.user };
  }

  @Post("login")
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const ipAddress = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const result = await this.authService.login(body, {
      ipAddress,
      userAgent: request.get("user-agent") ?? "unknown",
    });
    if ("mfaRequired" in result) {
      return { mfaRequired: true, challengeToken: result.challengeToken };
    }
    setSessionCookie(response, result.plainToken, result.expiresAt);
    return { user: result.user };
  }

  /** Second facteur : ouvre la session si le code TOTP du defi est valide. */
  @Post("mfa/verify")
  async verifyMfa(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.account.completeChallenge(body, {
      ipAddress: request.ip ?? request.socket.remoteAddress ?? "unknown",
      userAgent: request.get("user-agent") ?? "unknown",
    });
    setSessionCookie(response, result.plainToken, result.expiresAt);
    return { user: result.user };
  }

  @Post("password")
  @UseGuards(SessionGuard)
  async changePassword(@Req() request: Request, @Body() body: unknown) {
    const token = readSessionToken(request);
    return this.account.changePassword(request.axoraUser!, body, token ? hashSessionToken(token) : null);
  }

  @Get("mfa")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  async mfaStatus(@Req() request: Request) {
    return this.account.mfaStatus(request.axoraUser!);
  }

  @Post("mfa/setup")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  async startMfaSetup(@Req() request: Request, @Body() body: unknown) {
    return this.account.startMfaSetup(request.axoraUser!, body, requestMetadata(request));
  }

  @Post("mfa/enable")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  async enableMfa(@Req() request: Request, @Body() body: unknown) {
    const token = readSessionToken(request);
    return this.account.enableMfa(request.axoraUser!, body, requestMetadata(request), token ? hashSessionToken(token) : null);
  }

  @Post("mfa/disable")
  @UseGuards(SessionGuard)
  async disableMfa(@Req() request: Request, @Body() body: unknown) {
    const token = readSessionToken(request);
    return this.account.disableMfa(request.axoraUser!, body, requestMetadata(request), token ? hashSessionToken(token) : null);
  }

  @Post("mfa/recovery-codes")
  @UseGuards(SessionGuard)
  async regenerateRecoveryCodes(@Req() request: Request, @Body() body: unknown) {
    const token = readSessionToken(request);
    return this.account.regenerateRecoveryCodes(request.axoraUser!, body, requestMetadata(request), token ? hashSessionToken(token) : null);
  }

  /** Renouvelle la preuve MFA de la session courante avant une action sensible. */
  @Post("mfa/step-up")
  @UseGuards(SessionGuard)
  async stepUpMfa(@Req() request: Request, @Body() body: unknown) {
    return this.account.stepUp(request.axoraUser!, request.axoraSession!, body, requestMetadata(request));
  }

  @Post("logout")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const rawCookie = request.headers.cookie ?? "";
    const plainToken = rawCookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.split("=")[1];
    if (plainToken) {
      await this.authService.logout(decodeURIComponent(plainToken));
    }
    response.clearCookie(COOKIE_NAME);
    return { success: true };
  }

  @Get("me")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  async me(@Req() request: Request) {
    return { user: request.axoraUser };
  }

  /**
   * Contexte de travail de la session : organisation, entreprises accessibles
   * et cles de permission effectives. Sert UNIQUEMENT a adapter l'interface
   * (masquer un module inaccessible) : chaque route reste protegee cote
   * serveur par PermissionGuard, independamment de ce que l'UI affiche.
   */
  @Get("context")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  async context(@Req() request: Request) {
    return this.authService.context(request.axoraUser!);
  }
  @Get("preferences")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  preferences(@Req() request: Request) { return this.account.preferences(request.axoraUser!); }

  @Patch("preferences")
  @AllowMfaEnrollment()
  @UseGuards(SessionGuard)
  updatePreferences(@Req() request: Request, @Body() body: unknown) { return this.account.updatePreferences(request.axoraUser!, body); }
}

function setSessionCookie(response: Response, plainToken: string, expiresAt: Date): void {
  response.cookie(COOKIE_NAME, plainToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: expiresAt,
    path: "/",
  });
}

function readSessionToken(request: Request): string | undefined {
  const rawCookie = request.headers.cookie ?? "";
  const part = rawCookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE_NAME}=`));
  return part ? decodeURIComponent(part.slice(COOKIE_NAME.length + 1)) : undefined;
}

function requestMetadata(request: Request) {
  return { ipAddress: request.ip ?? request.socket.remoteAddress ?? "unknown", userAgent: request.get("user-agent") ?? "unknown" };
}
