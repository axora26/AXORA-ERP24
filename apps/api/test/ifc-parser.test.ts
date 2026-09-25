import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IfcParseError, decodeStepString, parseIfc } from "../src/bim/ifc-parser.js";

/**
 * Lecture IFC sur des fichiers REELS (buildingSMART Sample-Test-Files,
 * CC BY 4.0 — voir packages/database/demo/fixtures/ifc/README.md).
 */
const fixture = (name: string) => readFileSync(join(__dirname, "../../../packages/database/demo/fixtures/ifc", name));

describe("lecture IFC (STEP ISO 10303-21)", () => {
  it("fichiers de reference intacts (empreintes documentees)", () => {
    expect(createHash("sha256").update(fixture("Building-Hvac-IFC4.ifc")).digest("hex")).toBe("2c17ecad2b0fbd3335420ee42ba48963b5a395294e86bcdcfc786ee559f9a344");
    expect(createHash("sha256").update(fixture("Building-Hvac-IFC2X3.ifc")).digest("hex")).toBe("f39478ce12ae2029eed8b565551412a3a4b518d10a8b501bc5e9c2a8a6d78bdb");
  });

  it("IFC4 reel : en-tete, structure spatiale, elements CVC, niveau, type et systeme", () => {
    const model = parseIfc(fixture("Building-Hvac-IFC4.ifc").toString("utf8"));
    expect(model.schema).toBe("IFC4");
    expect(model.application).toContain("Sketchup_IFC_manager");
    expect(model.projectName).toBe("ifc silly sample scene - project");
    expect(model.entityCount).toBe(152);
    expect(model.spatial.map((node) => node.ifcType)).toEqual(["IFCPROJECT", "IFCSITE", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY"]);
    expect(model.spatial.find((node) => node.ifcType === "IFCBUILDINGSTOREY")).toMatchObject({ name: "00 groundfloor", parentGlobalId: "0c$N1CTon2BB2Sp89385G8" });
    expect(model.elements).toHaveLength(6);
    const duct = model.elements.find((element) => element.ifcType === "IFCDUCTSEGMENT");
    expect(duct).toMatchObject({ globalId: "38WbwIGD90nB_3T2BTU5Ed", storeyName: "00 groundfloor", objectType: "rigidsegment", systems: ["house - chimney flue"] });
    expect(model.elements.filter((element) => element.ifcType === "IFCAIRTERMINAL")).toHaveLength(2);
    expect(model.systems).toEqual([{ globalId: "2jrWSvrRvERBuat2Z0kgJ9", name: "house - chimney flue", ifcType: "IFCDISTRIBUTIONSYSTEM", memberCount: 3 }]);
    expect(model.warnings).toEqual([]);
  });

  it("IFC2X3 reel : memes identifiants GlobalId, classes de l'ancien schema", () => {
    const ifc4 = parseIfc(fixture("Building-Hvac-IFC4.ifc").toString("utf8"));
    const ifc2x3 = parseIfc(fixture("Building-Hvac-IFC2X3.ifc").toString("utf8"));
    expect(ifc2x3.schema).toBe("IFC2X3");
    expect(ifc2x3.entityCount).toBe(1625);
    const ids = (model: typeof ifc4) => model.elements.filter((element) => element.storeyName).map((element) => element.globalId).sort();
    expect(ids(ifc2x3)).toEqual(ids(ifc4));
    expect(ifc2x3.elements.find((element) => element.globalId === "38WbwIGD90nB_3T2BTU5Ed")?.ifcType).toBe("IFCFLOWSEGMENT");
  });

  it("IFC4X3_ADD2 reel : lu avec les memes elements que l'IFC4", () => {
    const content = fixture("Building-Hvac-IFC4X3.ifc");
    expect(createHash("sha256").update(content).digest("hex")).toBe("22891586f153793d098811caec8a510cd404f6c2f1979fb329eeeebc3f475642");
    const model = parseIfc(content.toString("utf8"));
    expect(model).toMatchObject({ schema: "IFC4X3_ADD2", entityCount: 152, warnings: [] });
    expect(model.elements.map((element) => element.ifcType).sort()).toEqual(["IFCAIRTERMINAL", "IFCAIRTERMINAL", "IFCBUILDINGELEMENTPROXY", "IFCBUILDINGELEMENTPROXY", "IFCCHIMNEY", "IFCDUCTSEGMENT"]);
  });

  it("lexique STEP : apostrophes doublees, encodages \\X2\\ et \\X\\, entites multi-lignes, commentaires", () => {
    expect(decodeStepString("l''air")).toBe("l'air");
    expect(decodeStepString("Chambre \\X2\\00E9\\X0\\t\\X2\\00E9\\X0\\")).toBe("Chambre été");
    expect(decodeStepString("caf\\X\\E9")).toBe("café");
    const content = [
      "ISO-10303-21;",
      "HEADER;FILE_DESCRIPTION((''),'2;1');FILE_NAME('t.ifc','2026-01-01',(''),(''),'','AXORA test','');FILE_SCHEMA(('IFC4'));ENDSEC;",
      "DATA;",
      "/* commentaire ; avec point-virgule */",
      "#1=IFCPROJECT('0000000000000000000001',$,'Projet ''test''',$,$,$,$,$,$);",
      "#2=IFCBUILDINGSTOREY('0000000000000000000002',$,'Niveau\\X2\\00A0\\X0\\1',$,$,$,$,$,.ELEMENT.,3.5);",
      "#3=IFCRELAGGREGATES('0000000000000000000003',$,$,$,#1,",
      "  (#2));",
      "#4=IFCWALL('0000000000000000000004',$,'Mur; porteur',$,$,#9,$,'M-01',$);",
      "#5=IFCRELCONTAINEDINSPATIALSTRUCTURE('0000000000000000000005',$,$,$,(#4),#2);",
      "#6=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('EI60'),$);",
      "#7=IFCPROPERTYSET('0000000000000000000007',$,'Pset_WallCommon',$,(#6));",
      "#8=IFCRELDEFINESBYPROPERTIES('0000000000000000000008',$,$,$,(#4),#7);",
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n");
    const model = parseIfc(content);
    expect(model.projectName).toBe("Projet 'test'");
    expect(model.elements).toEqual([
      expect.objectContaining({ ifcType: "IFCWALL", name: "Mur; porteur", tag: "M-01", storeyName: "Niveau 1", properties: { "Pset_WallCommon.FireRating": "EI60" } }),
    ]);
  });

  it("refuse un contenu qui n'est pas un fichier STEP / IFC", () => {
    expect(() => parseIfc("<html></html>")).toThrow(IfcParseError);
    expect(() => parseIfc("ISO-10303-21;\nHEADER;ENDSEC;\nDATA;\nENDSEC;")).toThrow(/FILE_SCHEMA/);
  });
});
