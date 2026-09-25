import type { Harness, Tenant } from "./harness.js";

/** Televersement multipart reel (meme chemin que le navigateur). */
export function upload(harness: Harness, tenant: Tenant, content: Buffer, filename: string, contentType = "application/octet-stream") {
  return harness.http().post("/api/v1/files").set("Cookie", tenant.cookie).attach("file", content, { filename, contentType });
}

/** Contenus minimaux portant une signature binaire reelle (JPEG, PNG, PDF). */
export const jpeg = (seed: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from(`JFIF ${seed}`)]);
export const png = (seed: string): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(seed)]);
export const pdf = (seed: string): Buffer => Buffer.from(`%PDF-1.4\n% ${seed}\n1 0 obj << >> endobj\n%%EOF\n`);
