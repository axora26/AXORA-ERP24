/**
 * Detection du type d'un fichier a partir de son contenu (signature binaire).
 * Le type annonce par le client n'est jamais cru : un fichier dont la
 * signature n'est pas reconnue est refuse (liste blanche stricte, aucun
 * HTML/SVG/script servi depuis le stockage).
 */
export interface DetectedFileType {
  mimeType: string;
  extension: string;
}

const OOXML: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString("latin1");
}

export function detectFileType(buffer: Buffer, originalName: string): DetectedFileType | null {
  const extension = originalName.toLowerCase().split(".").pop() ?? "";
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", extension: "jpg" };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: "image/png", extension: "png" };
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  if (ascii(buffer, 0, 5) === "%PDF-") return { mimeType: "application/pdf", extension: "pdf" };
  if (ascii(buffer, 0, 12) === "ISO-10303-21") return { mimeType: "application/x-step", extension: extension === "ifc" ? "ifc" : "stp" };
  if (/^AC10\d\d$/.test(ascii(buffer, 0, 6))) return { mimeType: "image/vnd.dwg", extension: "dwg" };
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    const office = OOXML[extension];
    if (office) return { mimeType: office, extension };
    if (extension === "zip") return { mimeType: "application/zip", extension: "zip" };
    return null;
  }
  return null;
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/") && mimeType !== "image/vnd.dwg";
}
