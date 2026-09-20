import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/password.js";

describe("password", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("Str0ngPassw0rd!");
    expect(await verifyPassword("Str0ngPassw0rd!", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("Str0ngPassw0rd!");
    expect(await verifyPassword("WrongPassword!", hash)).toBe(false);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("produces a different hash for the same password (unique salt)", async () => {
    const hash1 = await hashPassword("Str0ngPassw0rd!");
    const hash2 = await hashPassword("Str0ngPassw0rd!");
    expect(hash1).not.toBe(hash2);
  });
});
