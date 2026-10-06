#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const runtimeDir = path.join(root, "apps", "api", ".document-runtime");
const outputDir = path.join(root, "docs", "document-samples");
const sourceDir = path.join(root, "apps", "api", "src", "common");

async function transpile(name) {
  const source = await readFile(path.join(sourceDir, `${name}.ts`), "utf8");
  const result = ts.transpileModule(source, {
    fileName: `${name}.ts`,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
  });
  await writeFile(path.join(runtimeDir, `${name}.js`), result.outputText, "utf8");
}

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
try {
  await mkdir(outputDir, { recursive: true });
  for (const name of ["axora-pdf", "printable-document", "document-catalog"]) await transpile(name);

  const catalog = await import(`${pathToFileURL(path.join(runtimeDir, "document-catalog.js")).href}?v=${Date.now()}`);
  const rows = [];
  for (const sample of catalog.DOCUMENT_SAMPLES) {
    const buffer = await catalog.generateDocumentSample(sample);
    const target = path.join(outputDir, sample.filename);
    await writeFile(target, buffer);
    const pages = (buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    rows.push({ filename: sample.filename, use: sample.use, pages, bytes: buffer.byteLength });
    console.log(`${sample.filename}: ${pages} page(s), ${buffer.byteLength} octets`);
  }

  const readme = `# Exemples de documents AXORA ERP24\n\n> **DÉMONSTRATION — données fictives.** Ces fichiers illustrent les modèles générés par AXORA ERP24. Ils ne constituent ni des pièces comptables ni des justificatifs légaux. Les identifiants légaux absents restent indiqués \`[à renseigner]\`.\n\nGénérés par \`node scripts/generate-document-samples.mjs\`.\n\n| Fichier | Usage | Pages | Taille |\n|---|---|---:|---:|\n${rows.map((row) => `| [${row.filename}](./${row.filename}) | ${row.use} | ${row.pages} | ${row.bytes} octets |`).join("\n")}\n\n## Contrôles\n\nChaque PDF doit être contrôlé avec le script AXORA \`verify_pdf.py\` avant livraison. Les aperçus rasterisés se trouvent dans \`previews/\` lorsqu'ils ont été générés.\n`;
  await writeFile(path.join(outputDir, "README.md"), readme, "utf8");
  console.log(`Catalogue généré : ${rows.length} PDF dans ${outputDir}`);
} finally {
  await rm(runtimeDir, { recursive: true, force: true });
}
