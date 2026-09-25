/**
 * Lecture d'un fichier IFC au format STEP physique (ISO 10303-21).
 *
 * Portee volontairement limitee et verifiable : en-tete (schema,
 * application), structure spatiale (projet, sites, batiments, niveaux,
 * espaces), elements physiques avec leur niveau, leur type, leurs systemes,
 * proprietes simples et quantites. Aucune geometrie n'est interpretee.
 * Toute entite non reconnue est comptee, jamais ignoree silencieusement.
 */

export type StepValue = string | number | boolean | null | StepRef | StepEnum | StepTyped | StepValue[];

export interface StepRef {
  ref: number;
}
export interface StepEnum {
  enum: string;
}
export interface StepTyped {
  type: string;
  value: StepValue;
}

export interface StepEntity {
  id: number;
  type: string;
  args: StepValue[];
}

export interface IfcSpatialNode {
  globalId: string;
  ifcType: string;
  name: string | null;
  parentGlobalId: string | null;
}

export interface IfcElementRecord {
  globalId: string;
  ifcType: string;
  name: string | null;
  description: string | null;
  objectType: string | null;
  tag: string | null;
  containerGlobalId: string | null;
  storeyName: string | null;
  typeName: string | null;
  systems: string[];
  classifications: string[];
  properties: Record<string, string>;
  quantities: Record<string, string>;
}

export interface IfcParseResult {
  schema: string;
  application: string | null;
  projectName: string | null;
  entityCount: number;
  typeCounts: Record<string, number>;
  spatial: IfcSpatialNode[];
  elements: IfcElementRecord[];
  systems: Array<{ globalId: string; name: string | null; ifcType: string; memberCount: number }>;
  warnings: string[];
}

export class IfcParseError extends Error {}

const SPATIAL_TYPES = new Set(["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE", "IFCFACILITY", "IFCFACILITYPART", "IFCBRIDGE", "IFCROAD", "IFCRAILWAY"]);
const GROUP_TYPES = new Set(["IFCSYSTEM", "IFCDISTRIBUTIONSYSTEM", "IFCDISTRIBUTIONCIRCUIT", "IFCBUILDINGSYSTEM", "IFCZONE", "IFCGROUP"]);
const NON_ELEMENT_ROOTS = /^(IFCREL|IFCPROPERTYSET|IFCELEMENTQUANTITY|IFCOWNERHISTORY)|TYPE$|STYLE$/;
const GLOBAL_ID = /^[0-9A-Za-z_$]{22}$/;
const SUPPORTED_SCHEMAS = new Set(["IFC2X3", "IFC4", "IFC4X3", "IFC4X3_ADD2", "IFC4X1", "IFC4X2"]);

// ---------------------------------------------------------------------------
// Lexique STEP
// ---------------------------------------------------------------------------

/** Decode les chaines STEP : '' -> ', \X2\hhhh...\X0\ (UTF-16), \X\hh (ISO 8859-1), \S\c. */
export function decodeStepString(raw: string): string {
  let text = raw.replace(/''/g, "'");
  text = text.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_match, hex: string) => {
    let out = "";
    for (let index = 0; index + 4 <= hex.length; index += 4) out += String.fromCharCode(parseInt(hex.slice(index, index + 4), 16));
    return out;
  });
  text = text.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/\\S\\(.)/g, (_match, char: string) => String.fromCharCode(char.charCodeAt(0) + 128));
  return text.replace(/\\\\/g, "\\");
}

class Reader {
  private index = 0;
  constructor(private readonly text: string) {}

  private peek(): string {
    return this.text[this.index] ?? "";
  }

  private skipSpace(): void {
    while (this.index < this.text.length && /\s/.test(this.text[this.index]!)) this.index += 1;
  }

  parseList(): StepValue[] {
    this.skipSpace();
    if (this.peek() !== "(") throw new IfcParseError(`Expected '(' at ${this.index}`);
    this.index += 1;
    const values: StepValue[] = [];
    this.skipSpace();
    if (this.peek() === ")") {
      this.index += 1;
      return values;
    }
    for (;;) {
      values.push(this.parseValue());
      this.skipSpace();
      const char = this.peek();
      this.index += 1;
      if (char === ")") return values;
      if (char !== ",") throw new IfcParseError(`Expected ',' or ')' at ${this.index - 1}`);
    }
  }

  parseValue(): StepValue {
    this.skipSpace();
    const char = this.peek();
    if (char === "'") {
      let end = this.index + 1;
      for (;;) {
        const quote = this.text.indexOf("'", end);
        if (quote < 0) throw new IfcParseError("Unterminated string");
        if (this.text[quote + 1] === "'") {
          end = quote + 2;
          continue;
        }
        const raw = this.text.slice(this.index + 1, quote);
        this.index = quote + 1;
        return decodeStepString(raw);
      }
    }
    if (char === "(") return this.parseList();
    if (char === "$" || char === "*") {
      this.index += 1;
      return null;
    }
    if (char === "#") {
      const match = /^#(\d+)/.exec(this.text.slice(this.index, this.index + 20));
      if (!match) throw new IfcParseError(`Bad reference at ${this.index}`);
      this.index += match[0].length;
      return { ref: Number(match[1]) };
    }
    if (char === ".") {
      const end = this.text.indexOf(".", this.index + 1);
      const token = this.text.slice(this.index + 1, end);
      this.index = end + 1;
      if (token === "T") return true;
      if (token === "F") return false;
      if (token === "U") return null;
      return { enum: token };
    }
    if (char === '"') {
      const end = this.text.indexOf('"', this.index + 1);
      const token = this.text.slice(this.index + 1, end);
      this.index = end + 1;
      return token;
    }
    const numeric = /^[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)/.exec(this.text.slice(this.index, this.index + 40));
    if (numeric) {
      this.index += numeric[0].length;
      return Number(numeric[0]);
    }
    const typed = /^[A-Z][A-Z0-9_]*/.exec(this.text.slice(this.index, this.index + 80));
    if (typed) {
      this.index += typed[0].length;
      const inner = this.parseList();
      return { type: typed[0], value: inner.length === 1 ? inner[0]! : inner };
    }
    throw new IfcParseError(`Unexpected character '${char}' at ${this.index}`);
  }
}

/** Decoupe la section DATA en instances `#id=TYPE(args);` en respectant les chaines. */
function splitStatements(data: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let inString = false;
  for (let index = 0; index < data.length; index += 1) {
    const char = data[index];
    if (char === "'") {
      if (inString && data[index + 1] === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
    } else if (char === ";" && !inString) {
      const statement = data.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  return statements;
}

function stripComments(text: string): string {
  let out = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !inString) inString = true;
    else if (char === "'" && inString) {
      if (text[index + 1] === "'") {
        out += "''";
        index += 1;
        continue;
      }
      inString = false;
    } else if (!inString && char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    out += char;
  }
  return out;
}

export function parseStep(content: string): { header: Record<string, StepValue[]>; entities: Map<number, StepEntity> } {
  const text = stripComments(content);
  if (!text.trimStart().startsWith("ISO-10303-21;")) throw new IfcParseError("Not an ISO-10303-21 (STEP) file");
  const headerStart = text.indexOf("HEADER;");
  const dataStart = text.indexOf("DATA;");
  const dataEnd = text.lastIndexOf("ENDSEC;");
  if (headerStart < 0 || dataStart < 0 || dataEnd < dataStart) throw new IfcParseError("Missing HEADER or DATA section");

  const header: Record<string, StepValue[]> = {};
  for (const statement of splitStatements(text.slice(headerStart + 7, text.indexOf("ENDSEC;", headerStart)))) {
    const match = /^([A-Z_]+)\s*(\(.*)$/s.exec(statement);
    if (match) header[match[1]!] = new Reader(match[2]!).parseList();
  }

  const entities = new Map<number, StepEntity>();
  for (const statement of splitStatements(text.slice(dataStart + 5, dataEnd))) {
    const match = /^#(\d+)\s*=\s*([A-Z0-9_]+)\s*(\(.*)$/s.exec(statement);
    if (!match) continue;
    entities.set(Number(match[1]), { id: Number(match[1]), type: match[2]!, args: new Reader(match[3]!).parseList() });
  }
  return { header, entities };
}

// ---------------------------------------------------------------------------
// Interpretation IFC
// ---------------------------------------------------------------------------

const str = (value: StepValue | undefined): string | null => (typeof value === "string" ? value : null);
const refs = (value: StepValue | undefined): number[] =>
  Array.isArray(value) ? value.filter((item): item is StepRef => typeof item === "object" && item !== null && "ref" in item).map((item) => item.ref) : [];
const refOf = (value: StepValue | undefined): number | null => (typeof value === "object" && value !== null && "ref" in value ? value.ref : null);

function displayValue(value: StepValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "VRAI" : "FAUX";
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if ("enum" in value) return value.enum;
  if ("type" in value) return displayValue(value.value);
  return null;
}

export function parseIfc(content: string): IfcParseResult {
  const { header, entities } = parseStep(content);
  const schemaList = header.FILE_SCHEMA?.[0];
  const schema = (Array.isArray(schemaList) ? str(schemaList[0]) : null)?.toUpperCase() ?? "";
  if (!schema) throw new IfcParseError("FILE_SCHEMA is missing");
  const warnings: string[] = [];
  if (!SUPPORTED_SCHEMAS.has(schema)) warnings.push(`Schéma ${schema} non vérifié : lecture générique`);
  const application = str(header.FILE_NAME?.[5]) ?? str(header.FILE_NAME?.[6]) ?? null;

  const typeCounts: Record<string, number> = {};
  for (const entity of entities.values()) typeCounts[entity.type] = (typeCounts[entity.type] ?? 0) + 1;

  const globalIdOf = (id: number | null): string | null => {
    if (id === null) return null;
    const entity = entities.get(id);
    const value = str(entity?.args[0]);
    return value && GLOBAL_ID.test(value) ? value : null;
  };

  // Structure spatiale : IfcRelAggregates (4 = relatant, 5 = relies).
  const parentOf = new Map<number, number>();
  for (const entity of entities.values()) {
    if (entity.type !== "IFCRELAGGREGATES") continue;
    const parent = refOf(entity.args[4]);
    if (parent === null) continue;
    for (const child of refs(entity.args[5])) parentOf.set(child, parent);
  }
  const spatial: IfcSpatialNode[] = [];
  let projectName: string | null = null;
  for (const entity of entities.values()) {
    if (!SPATIAL_TYPES.has(entity.type)) continue;
    const globalId = globalIdOf(entity.id);
    if (!globalId) continue;
    if (entity.type === "IFCPROJECT") projectName = str(entity.args[2]) ?? str(entity.args[4]);
    spatial.push({ globalId, ifcType: entity.type, name: str(entity.args[2]), parentGlobalId: globalIdOf(parentOf.get(entity.id) ?? null) });
  }

  // Contenu : IfcRelContainedInSpatialStructure (4 = elements, 5 = structure).
  const containerOf = new Map<number, number>();
  for (const entity of entities.values()) {
    if (entity.type !== "IFCRELCONTAINEDINSPATIALSTRUCTURE") continue;
    const structure = refOf(entity.args[5]);
    if (structure === null) continue;
    for (const element of refs(entity.args[4])) containerOf.set(element, structure);
  }
  const storeyOf = (id: number | null): string | null => {
    let current = id;
    for (let depth = 0; current !== null && depth < 20; depth += 1) {
      const entity = entities.get(current);
      if (!entity) return null;
      if (entity.type === "IFCBUILDINGSTOREY") return str(entity.args[2]);
      current = parentOf.get(current) ?? null;
    }
    return null;
  };

  // Types, systemes, classifications, proprietes et quantites.
  const typeOf = new Map<number, string>();
  const systemsOf = new Map<number, string[]>();
  const classificationsOf = new Map<number, string[]>();
  const propertiesOf = new Map<number, Record<string, string>>();
  const quantitiesOf = new Map<number, Record<string, string>>();
  const systems: IfcParseResult["systems"] = [];
  const push = <T>(map: Map<number, T[]>, key: number, value: T) => map.set(key, [...(map.get(key) ?? []), value]);

  for (const entity of entities.values()) {
    switch (entity.type) {
      case "IFCRELDEFINESBYTYPE": {
        const type = entities.get(refOf(entity.args[5]) ?? -1);
        const name = str(type?.args[2]) ?? type?.type ?? null;
        if (name) for (const related of refs(entity.args[4])) typeOf.set(related, name);
        break;
      }
      case "IFCRELASSIGNSTOGROUP": {
        const group = entities.get(refOf(entity.args[6]) ?? -1);
        if (!group || !GROUP_TYPES.has(group.type)) break;
        const name = str(group.args[2]) ?? group.type;
        const members = refs(entity.args[4]);
        for (const member of members) push(systemsOf, member, name);
        const globalId = globalIdOf(group.id);
        if (globalId) systems.push({ globalId, name: str(group.args[2]), ifcType: group.type, memberCount: members.length });
        break;
      }
      case "IFCRELASSOCIATESCLASSIFICATION": {
        const reference = entities.get(refOf(entity.args[5]) ?? -1);
        const label = [str(reference?.args[1]), str(reference?.args[2])].filter(Boolean).join(" — ");
        if (label) for (const related of refs(entity.args[4])) push(classificationsOf, related, label);
        break;
      }
      case "IFCRELDEFINESBYPROPERTIES": {
        const definition = entities.get(refOf(entity.args[5]) ?? -1);
        if (!definition) break;
        const setName = str(definition.args[2]) ?? definition.type;
        const target = definition.type === "IFCELEMENTQUANTITY" ? quantitiesOf : propertiesOf;
        const items = definition.type === "IFCELEMENTQUANTITY" ? refs(definition.args[5]) : refs(definition.args[4]);
        const values: Record<string, string> = {};
        for (const itemId of items) {
          const item = entities.get(itemId);
          if (!item) continue;
          const name = str(item.args[0]);
          if (!name) continue;
          const value = item.type === "IFCPROPERTYSINGLEVALUE" ? displayValue(item.args[2]) : item.type.startsWith("IFCQUANTITY") ? displayValue(item.args[3]) : null;
          if (value !== null) values[`${setName}.${name}`] = value;
        }
        for (const related of refs(entity.args[4])) target.set(related, { ...(target.get(related) ?? {}), ...values });
        break;
      }
    }
  }

  const elements: IfcElementRecord[] = [];
  for (const entity of entities.values()) {
    if (SPATIAL_TYPES.has(entity.type) || GROUP_TYPES.has(entity.type) || NON_ELEMENT_ROOTS.test(entity.type)) continue;
    const globalId = globalIdOf(entity.id);
    if (!globalId) continue;
    // Un element physique porte un placement (arg 5) ou est contenu dans la structure spatiale.
    if (refOf(entity.args[5]) === null && !containerOf.has(entity.id)) continue;
    const container = containerOf.get(entity.id) ?? null;
    elements.push({
      globalId,
      ifcType: entity.type,
      name: str(entity.args[2]),
      description: str(entity.args[3]),
      objectType: str(entity.args[4]),
      tag: str(entity.args[7]),
      containerGlobalId: globalIdOf(container),
      storeyName: storeyOf(container),
      typeName: typeOf.get(entity.id) ?? null,
      systems: systemsOf.get(entity.id) ?? [],
      classifications: classificationsOf.get(entity.id) ?? [],
      properties: propertiesOf.get(entity.id) ?? {},
      quantities: quantitiesOf.get(entity.id) ?? {},
    });
  }
  if (elements.length === 0) warnings.push("Aucun élément physique reconnu dans le modèle");

  return { schema, application, projectName, entityCount: entities.size, typeCounts, spatial, elements, systems, warnings };
}
