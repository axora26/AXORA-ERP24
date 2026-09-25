import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Stockage objet des fichiers. Les cles sont derivees de l'empreinte SHA-256
 * du contenu : un objet ecrit n'est jamais reecrit (immutabilite).
 *
 * Pilote livre : systeme de fichiers local (developpement, poste unique).
 * Un pilote compatible S3 (docs/foundation/01-architecture.md) implemente la
 * meme interface ; il n'est pas encore livre (NOT_TESTED).
 */
export interface FileStorage {
  readonly driver: string;
  put(key: string, content: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
}

export const FILE_STORAGE = Symbol("FILE_STORAGE");

function workspaceRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export class LocalFileStorage implements FileStorage {
  readonly driver = "local";
  private readonly root: string;

  constructor(root = process.env.FILE_STORAGE_DIR || join(workspaceRoot(process.cwd()), ".data", "files")) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!/^[a-z0-9]+\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(key)) throw new Error("Invalid storage key");
    return join(this.root, key);
  }

  async put(key: string, content: Buffer): Promise<void> {
    const target = this.path(key);
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (exists) return; // meme empreinte = meme contenu : jamais reecrit
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, target);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}
