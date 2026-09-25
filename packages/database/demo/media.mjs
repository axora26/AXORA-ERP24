import { crc32, deflateSync } from "node:zlib";

/**
 * Medias DEMO generes localement (aucun telechargement, aucune photo reelle) :
 * images PNG synthetiques figurant une scene de chantier, et PDF texte.
 * Ils portent de vraies signatures binaires : le serveur les accepte comme
 * n'importe quel fichier televerse.
 */

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SCENES = {
  // Gaine metallique nue sous dalle.
  duct: { wall: [214, 211, 204], floor: [150, 146, 138], accent: [176, 186, 196], accentBand: [0.28, 0.42], mark: [220, 60, 50] },
  // Meme gaine, calorifugee (correction).
  ductFixed: { wall: [214, 211, 204], floor: [150, 146, 138], accent: [235, 225, 120], accentBand: [0.26, 0.44], mark: [60, 170, 90] },
  // Plafond avec ouverture sans trappe.
  ceiling: { wall: [236, 234, 228], floor: [120, 118, 112], accent: [40, 40, 44], accentBand: [0.45, 0.62], mark: [230, 150, 40] },
  // Toiture technique, garde-corps.
  roof: { wall: [150, 190, 230], floor: [110, 112, 116], accent: [250, 200, 40], accentBand: [0.55, 0.6], mark: [220, 60, 50] },
  roofFixed: { wall: [150, 190, 230], floor: [110, 112, 116], accent: [250, 200, 40], accentBand: [0.45, 0.6], mark: [60, 170, 90] },
  site: { wall: [196, 214, 232], floor: [168, 140, 104], accent: [120, 120, 124], accentBand: [0.35, 0.7], mark: [240, 180, 40] },
};

/** Image PNG 480x320 figurant une scene (fond, sol, element technique, repere). */
export function scenePng(name, seed = 0) {
  const scene = SCENES[name] ?? SCENES.site;
  const width = 480;
  const height = 320;
  return encodePng(width, height, (x, y) => {
    const v = y / height;
    const noise = ((x * 73 + y * 151 + seed * 97) % 17) - 8;
    const shade = (color, factor) => color.map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor + noise))));
    const markX = width * 0.68;
    const markY = height * ((scene.accentBand[0] + scene.accentBand[1]) / 2);
    if ((x - markX) ** 2 + (y - markY) ** 2 < 26 ** 2 && (x - markX) ** 2 + (y - markY) ** 2 > 20 ** 2) return scene.mark;
    if (v > scene.accentBand[0] && v < scene.accentBand[1] && x > width * 0.08 && x < width * 0.92) return shade(scene.accent, 1 - Math.abs(v - 0.35) * 0.6);
    if (v > 0.72) return shade(scene.floor, 1.1 - v * 0.3);
    return shade(scene.wall, 1.05 - v * 0.2);
  });
}

function escapePdf(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** PDF A4 d'une page, texte Helvetica, avec table xref exacte (s'ouvre dans tout lecteur). */
export function textPdf(title, lines) {
  const content = [
    "BT /F1 18 Tf 56 780 Td (" + escapePdf(title) + ") Tj ET",
    "BT /F1 9 Tf 56 764 Td (AXORA-ERP24 - DOCUMENT DE DEMONSTRATION - donnees fictives) Tj ET",
    ...lines.map((line, index) => `BT /F1 11 Tf 56 ${730 - index * 18} Td (${escapePdf(line)}) Tj ET`),
    "0.2 0.4 0.8 RG 2 w 56 750 m 539 750 l S",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
