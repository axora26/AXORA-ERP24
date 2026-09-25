import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PERMISSION_GROUPS, isKnownPermission, permissionCatalog } from "@axora24/contracts";

/**
 * Regression : ALL_PERMISSIONS etait construit par fusion d'objets ; deux
 * modules exposant une constante READ ou MANAGE s'ecrasaient et des
 * permissions disparaissaient du role OWNER et du catalogue.
 */
describe("catalogue des permissions", () => {
  it("contient chaque permission de chaque module, sans perte ni doublon", () => {
    const declared = PERMISSION_GROUPS.flatMap((group) => Object.values(group) as string[]);
    const catalog = Object.values(ALL_PERMISSIONS) as string[];
    expect(new Set(declared).size).toBe(declared.length);
    expect([...catalog].sort()).toEqual([...declared].sort());
    for (const key of ["qhse.inspection.read", "mep.system.read", "mep.system.manage", "commissioning.activity.read", "commissioning.activity.manage"]) {
      expect(isKnownPermission(key)).toBe(true);
    }
  });

  it("respecte la convention <module>.<ressource>.<action> et regroupe par module", () => {
    for (const key of Object.values(ALL_PERMISSIONS) as string[]) expect(key).toMatch(/^[a-z]+\.[a-z]+\.[a-z]+$/);
    const total = permissionCatalog().reduce((sum, group) => sum + group.permissions.length, 0);
    expect(total).toBe(Object.values(ALL_PERMISSIONS).length);
  });
});
