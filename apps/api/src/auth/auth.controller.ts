import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import type { LoginDto, RegisterOrganizationDto } from "./auth.dto.js";
import { SessionGuard } from "./session.guard.js";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "axora_erp24_session";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register-organization")
  async registerOrganization(
    @Body() body: RegisterOrganizationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.registerOrganization(body);
    setSessionCookie(response, result.plainToken, result.expiresAt);
    return { user: result.user };
  }

  @Post("login")
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(body);
    setSessionCookie(response, result.plainToken, result.expiresAt);
    return { user: result.user };
  }

  @Post("logout")
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
  @UseGuards(SessionGuard)
  async me(@Req() request: Request) {
    return { user: request.axoraUser };
  }
}

function setSessionCookie(response: Response, plainToken: string, expiresAt: Date): void {
  response.cookie(COOKIE_NAME, plainToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}
