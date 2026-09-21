import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRootEnv } from "../src/config/env.js";

/**
 * Le chargeur .env porte un invariant de securite : il ne doit JAMAIS
 * ecraser une variable deja definie dans l'environnement reel (CI, Docker,
 * secrets injectes). Un ecrasement silencieux ferait pointer une CI ou une
 * production vers la base de developpement.
 */
describe("loadRootEnv", () => {
  const touchedKeys: string[] = [];

  function track(key: string): string {
    touchedKeys.push(key);
    return key;
  }

  afterEach(() => {
    for (const key of touchedKeys.splice(0)) {
      delete process.env[key];
    }
  });

  function writeEnvFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "axora-env-"));
    writeFileSync(join(dir, ".env"), content, "utf8");
    return dir;
  }

  it("applies variables that are absent from process.env", () => {
    const key = track("AXORA_TEST_ABSENT");
    const dir = writeEnvFile(`${key}=loaded-from-file\n`);

    const applied = loadRootEnv(dir);

    expect(applied).toContain(key);
    expect(process.env[key]).toBe("loaded-from-file");
  });

  it("never overrides a variable already present in the real environment", () => {
    const key = track("AXORA_TEST_PRESENT");
    process.env[key] = "value-from-ci";
    const dir = writeEnvFile(`${key}=value-from-dotenv\n`);

    const applied = loadRootEnv(dir);

    expect(applied).not.toContain(key);
    expect(process.env[key]).toBe("value-from-ci");
  });

  it("ignores comments and blank lines, and strips surrounding quotes", () => {
    const quoted = track("AXORA_TEST_QUOTED");
    const commented = track("AXORA_TEST_COMMENTED");
    const dir = writeEnvFile(
      ["# commentaire", "", `${quoted}="postgresql://user@host:5432/db"`, `# ${commented}=ignore`].join(
        "\n",
      ),
    );

    loadRootEnv(dir);

    expect(process.env[quoted]).toBe("postgresql://user@host:5432/db");
    expect(process.env[commented]).toBeUndefined();
  });

  it("returns an empty list when no .env file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "axora-env-empty-"));
    expect(loadRootEnv(dir)).toEqual([]);
  });
});
