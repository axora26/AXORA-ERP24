import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  isDemo?: boolean;
}

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateOrganizationInput) {
    return this.prisma.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        isDemo: input.isDemo ?? false,
      },
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.organization.findUnique({ where: { slug } });
  }

  async list() {
    return this.prisma.organization.findMany({ orderBy: { createdAt: "desc" } });
  }
}
