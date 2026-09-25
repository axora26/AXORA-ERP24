import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@axora24/database";

/**
 * Noyau de calcul MEP (INC-13, docs/foundation/02-domain-model.md BC-13).
 *
 * REGLES NON NEGOCIABLES :
 * - chaque calcul expose ses donnees d'entree (valeur + unite), sa formule
 *   symbolique et la formule substituee : le resultat est verifiable a la main ;
 * - aucune valeur physique n'est cachee : masse volumique, chaleur massique,
 *   resistivite... sont des ENTREES saisies et justifiees par l'ingenieur ;
 * - seules des relations physiques elementaires sont implementees ; aucune
 *   norme de dimensionnement n'est codee sans source verifiee (zones non
 *   couvertes listees explicitement dans NOT_COVERED) ;
 * - arithmetique decimale a 40 chiffres significatifs (constantes
 *   irrationnelles comprises), arrondi final declare par grandeur.
 */
export const KERNEL_VERSION = "mep-kernel/1.0.0";

const D = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof D>;
const SQRT3 = new D(3).sqrt();
const PI = D.acos(-1);

export type MepDisciplineKey = "HVAC" | "ELECTRICAL" | "LOW_CURRENT" | "PLUMBING" | "FIRE_PROTECTION";

export interface CalcInputSpec {
  name: string;
  symbol: string;
  label: string;
  unit: string;
  /** Borne inferieure stricte (> min). */
  greaterThan?: string;
  /** Borne superieure inclusive (<= max). */
  atMost?: string;
  hint?: string;
}

export interface CalcOutputSpec {
  name: string;
  symbol: string;
  label: string;
  unit: string;
  decimals: number;
}

export interface CalcDefinition {
  type: string;
  disciplines: MepDisciplineKey[];
  title: string;
  description: string;
  formula: string;
  inputs: CalcInputSpec[];
  outputs: CalcOutputSpec[];
  assumptions: string[];
  compute: (x: Record<string, Dec>) => { values: Record<string, Dec>; substitution: string };
}

const fmt = (value: Dec) => value.toSignificantDigits(12).toString();

export const CALCULATIONS: CalcDefinition[] = [
  {
    type: "hvac.air_flow_sensible",
    disciplines: ["HVAC"],
    title: "Débit d'air pour une puissance sensible",
    description: "Débit volumique d'air nécessaire pour transporter une puissance sensible avec un écart de température donné.",
    formula: "qv = P × 3600 / (ρ × cp × ΔT)",
    inputs: [
      { name: "power", symbol: "P", label: "Puissance sensible", unit: "W", greaterThan: "0" },
      { name: "density", symbol: "ρ", label: "Masse volumique de l'air", unit: "kg/m³", greaterThan: "0", hint: "À justifier selon température et altitude" },
      { name: "heatCapacity", symbol: "cp", label: "Chaleur massique de l'air", unit: "J/(kg·K)", greaterThan: "0" },
      { name: "deltaT", symbol: "ΔT", label: "Écart de température soufflage / ambiance", unit: "K", greaterThan: "0" },
    ],
    outputs: [
      { name: "flow", symbol: "qv", label: "Débit d'air", unit: "m³/h", decimals: 1 },
      { name: "flowPerSecond", symbol: "qv", label: "Débit d'air", unit: "m³/s", decimals: 4 },
    ],
    assumptions: ["Régime permanent, chaleur sensible uniquement (chaleur latente non traitée)."],
    compute: (x) => {
      const flow = x.power!.mul(3600).div(x.density!.mul(x.heatCapacity!).mul(x.deltaT!));
      return {
        values: { flow, flowPerSecond: flow.div(3600) },
        substitution: `qv = ${fmt(x.power!)} × 3600 / (${fmt(x.density!)} × ${fmt(x.heatCapacity!)} × ${fmt(x.deltaT!)})`,
      };
    },
  },
  {
    type: "hvac.water_flow",
    disciplines: ["HVAC", "PLUMBING"],
    title: "Débit d'eau d'un circuit hydraulique",
    description: "Débit volumique d'eau nécessaire pour transporter une puissance avec un écart départ / retour donné.",
    formula: "qv = P × 3600 / (ρ × cp × ΔT)",
    inputs: [
      { name: "power", symbol: "P", label: "Puissance transportée", unit: "W", greaterThan: "0" },
      { name: "density", symbol: "ρ", label: "Masse volumique du fluide", unit: "kg/m³", greaterThan: "0" },
      { name: "heatCapacity", symbol: "cp", label: "Chaleur massique du fluide", unit: "J/(kg·K)", greaterThan: "0", hint: "Eau glycolée : valeur à justifier" },
      { name: "deltaT", symbol: "ΔT", label: "Écart départ / retour", unit: "K", greaterThan: "0" },
    ],
    outputs: [{ name: "flow", symbol: "qv", label: "Débit d'eau", unit: "m³/h", decimals: 3 }],
    assumptions: ["Propriétés du fluide constantes sur la plage de température considérée."],
    compute: (x) => ({
      values: { flow: x.power!.mul(3600).div(x.density!.mul(x.heatCapacity!).mul(x.deltaT!)) },
      substitution: `qv = ${fmt(x.power!)} × 3600 / (${fmt(x.density!)} × ${fmt(x.heatCapacity!)} × ${fmt(x.deltaT!)})`,
    }),
  },
  {
    type: "elec.current_single_phase",
    disciplines: ["ELECTRICAL", "LOW_CURRENT"],
    title: "Courant d'emploi monophasé",
    description: "Intensité absorbée par une charge monophasée.",
    formula: "I = P / (U × cos φ)",
    inputs: [
      { name: "power", symbol: "P", label: "Puissance active", unit: "W", greaterThan: "0" },
      { name: "voltage", symbol: "U", label: "Tension phase-neutre", unit: "V", greaterThan: "0" },
      { name: "powerFactor", symbol: "cos φ", label: "Facteur de puissance", unit: "—", greaterThan: "0", atMost: "1" },
    ],
    outputs: [{ name: "current", symbol: "I", label: "Courant d'emploi", unit: "A", decimals: 2 }],
    assumptions: ["Charge sinusoïdale équilibrée, harmoniques non prises en compte."],
    compute: (x) => ({
      values: { current: x.power!.div(x.voltage!.mul(x.powerFactor!)) },
      substitution: `I = ${fmt(x.power!)} / (${fmt(x.voltage!)} × ${fmt(x.powerFactor!)})`,
    }),
  },
  {
    type: "elec.current_three_phase",
    disciplines: ["ELECTRICAL"],
    title: "Courant d'emploi triphasé",
    description: "Intensité par phase d'une charge triphasée équilibrée.",
    formula: "I = P / (√3 × U × cos φ)",
    inputs: [
      { name: "power", symbol: "P", label: "Puissance active", unit: "W", greaterThan: "0" },
      { name: "voltage", symbol: "U", label: "Tension entre phases", unit: "V", greaterThan: "0" },
      { name: "powerFactor", symbol: "cos φ", label: "Facteur de puissance", unit: "—", greaterThan: "0", atMost: "1" },
    ],
    outputs: [{ name: "current", symbol: "I", label: "Courant par phase", unit: "A", decimals: 2 }],
    assumptions: ["Réseau triphasé équilibré ; √3 calculée à 40 chiffres significatifs."],
    compute: (x) => ({
      values: { current: x.power!.div(SQRT3.mul(x.voltage!).mul(x.powerFactor!)) },
      substitution: `I = ${fmt(x.power!)} / (√3 × ${fmt(x.voltage!)} × ${fmt(x.powerFactor!)})`,
    }),
  },
  {
    type: "elec.voltage_drop_single_phase",
    disciplines: ["ELECTRICAL", "LOW_CURRENT"],
    title: "Chute de tension monophasée (résistive)",
    description: "Chute de tension aller-retour d'une canalisation monophasée, composante résistive uniquement.",
    formula: "ΔU = 2 × ρ × L × I / S ; ΔU% = ΔU / U × 100",
    inputs: [
      { name: "current", symbol: "I", label: "Courant d'emploi", unit: "A", greaterThan: "0" },
      { name: "length", symbol: "L", label: "Longueur simple de la canalisation", unit: "m", greaterThan: "0" },
      { name: "section", symbol: "S", label: "Section du conducteur", unit: "mm²", greaterThan: "0" },
      { name: "resistivity", symbol: "ρ", label: "Résistivité du conducteur", unit: "Ω·mm²/m", greaterThan: "0", hint: "Dépend du métal et de la température : valeur et source à citer" },
      { name: "voltage", symbol: "U", label: "Tension nominale", unit: "V", greaterThan: "0" },
    ],
    outputs: [
      { name: "drop", symbol: "ΔU", label: "Chute de tension", unit: "V", decimals: 2 },
      { name: "dropPercent", symbol: "ΔU%", label: "Chute de tension relative", unit: "%", decimals: 2 },
    ],
    assumptions: ["Réactance linéique négligée (cos φ = 1) : le résultat sous-estime la chute pour les fortes sections."],
    compute: (x) => {
      const drop = new D(2).mul(x.resistivity!).mul(x.length!).mul(x.current!).div(x.section!);
      return {
        values: { drop, dropPercent: drop.div(x.voltage!).mul(100) },
        substitution: `ΔU = 2 × ${fmt(x.resistivity!)} × ${fmt(x.length!)} × ${fmt(x.current!)} / ${fmt(x.section!)} ; ΔU% = ΔU / ${fmt(x.voltage!)} × 100`,
      };
    },
  },
  {
    type: "elec.voltage_drop_three_phase",
    disciplines: ["ELECTRICAL"],
    title: "Chute de tension triphasée (résistive)",
    description: "Chute de tension entre phases d'une canalisation triphasée équilibrée, composante résistive uniquement.",
    formula: "ΔU = √3 × ρ × L × I / S ; ΔU% = ΔU / U × 100",
    inputs: [
      { name: "current", symbol: "I", label: "Courant d'emploi", unit: "A", greaterThan: "0" },
      { name: "length", symbol: "L", label: "Longueur de la canalisation", unit: "m", greaterThan: "0" },
      { name: "section", symbol: "S", label: "Section du conducteur", unit: "mm²", greaterThan: "0" },
      { name: "resistivity", symbol: "ρ", label: "Résistivité du conducteur", unit: "Ω·mm²/m", greaterThan: "0", hint: "Valeur et source à citer" },
      { name: "voltage", symbol: "U", label: "Tension entre phases", unit: "V", greaterThan: "0" },
    ],
    outputs: [
      { name: "drop", symbol: "ΔU", label: "Chute de tension", unit: "V", decimals: 2 },
      { name: "dropPercent", symbol: "ΔU%", label: "Chute de tension relative", unit: "%", decimals: 2 },
    ],
    assumptions: ["Réactance linéique négligée (cos φ = 1).", "Réseau triphasé équilibré, neutre non chargé."],
    compute: (x) => {
      const drop = SQRT3.mul(x.resistivity!).mul(x.length!).mul(x.current!).div(x.section!);
      return {
        values: { drop, dropPercent: drop.div(x.voltage!).mul(100) },
        substitution: `ΔU = √3 × ${fmt(x.resistivity!)} × ${fmt(x.length!)} × ${fmt(x.current!)} / ${fmt(x.section!)} ; ΔU% = ΔU / ${fmt(x.voltage!)} × 100`,
      };
    },
  },
  {
    type: "fluid.velocity_round_section",
    disciplines: ["HVAC", "PLUMBING", "FIRE_PROTECTION"],
    title: "Vitesse dans une section circulaire",
    description: "Vitesse moyenne d'un fluide dans un conduit ou une tuyauterie de diamètre intérieur donné.",
    formula: "v = (qv / 3600) / (π × (d / 1000)² / 4)",
    inputs: [
      { name: "flow", symbol: "qv", label: "Débit volumique", unit: "m³/h", greaterThan: "0" },
      { name: "diameter", symbol: "d", label: "Diamètre intérieur", unit: "mm", greaterThan: "0" },
    ],
    outputs: [{ name: "velocity", symbol: "v", label: "Vitesse moyenne", unit: "m/s", decimals: 2 }],
    assumptions: ["Section pleine, vitesse moyenne débitante ; π calculé à 40 chiffres significatifs."],
    compute: (x) => {
      const area = PI.mul(x.diameter!.div(1000).pow(2)).div(4);
      return {
        values: { velocity: x.flow!.div(3600).div(area) },
        substitution: `v = (${fmt(x.flow!)} / 3600) / (π × (${fmt(x.diameter!)} / 1000)² / 4)`,
      };
    },
  },
  {
    type: "fluid.diameter_for_velocity",
    disciplines: ["HVAC", "PLUMBING"],
    title: "Diamètre pour une vitesse cible",
    description: "Diamètre intérieur théorique d'un conduit circulaire pour transporter un débit à une vitesse choisie.",
    formula: "d = 1000 × √(4 × (qv / 3600) / (π × v))",
    inputs: [
      { name: "flow", symbol: "qv", label: "Débit volumique", unit: "m³/h", greaterThan: "0" },
      { name: "velocity", symbol: "v", label: "Vitesse cible", unit: "m/s", greaterThan: "0", hint: "Choix de conception à justifier (acoustique, pertes de charge)" },
    ],
    outputs: [{ name: "diameter", symbol: "d", label: "Diamètre intérieur théorique", unit: "mm", decimals: 1 }],
    assumptions: ["Diamètre théorique : le choix d'un diamètre commercial reste une décision d'ingénierie."],
    compute: (x) => ({
      values: { diameter: new D(1000).mul(new D(4).mul(x.flow!.div(3600)).div(PI.mul(x.velocity!)).sqrt()) },
      substitution: `d = 1000 × √(4 × (${fmt(x.flow!)} / 3600) / (π × ${fmt(x.velocity!)}))`,
    }),
  },
];

/** Zones de calcul volontairement non couvertes : jamais approximees silencieusement. */
export const NOT_COVERED: Array<{ domain: string; reason: string }> = [
  { domain: "Bilan thermique réglementaire (déperditions, apports)", reason: "Méthode normative (ex. EN 12831) non implémentée sans source vérifiée" },
  { domain: "Choix des protections et sections selon la norme d'installation", reason: "Règles nationales (ex. CEI 60364 et déclinaisons) non codées" },
  { domain: "Pertes de charge réseaux (rugosité, singularités)", reason: "Corrélations et coefficients non encore sourcés" },
  { domain: "Dimensionnement sprinklers / RIA", reason: "Règles d'assureur ou normes locales non codées" },
  { domain: "Éclairement et bilans de puissance courants faibles", reason: "Non implémentés" },
];

export interface CalculationResult {
  inputs: Array<{ name: string; symbol: string; label: string; unit: string; value: string }>;
  outputs: Array<{ name: string; symbol: string; label: string; unit: string; value: string }>;
  formula: string;
  substitution: string;
  assumptions: string[];
  kernelVersion: string;
}

const DECIMAL_TEXT = /^\d{1,12}(\.\d{1,10})?$/;

export function findCalculation(type: string): CalcDefinition {
  const definition = CALCULATIONS.find((candidate) => candidate.type === type);
  if (!definition) throw new BadRequestException(`Unknown calculation type "${type}"`);
  return definition;
}

/** Execute un calcul : les entrees sont des chaines decimales (jamais des nombres JSON). */
export function runCalculation(type: string, raw: unknown): CalculationResult {
  const definition = findCalculation(type);
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const values: Record<string, Dec> = {};
  for (const input of definition.inputs) {
    const text = source[input.name];
    if (typeof text !== "string" || !DECIMAL_TEXT.test(text.trim())) {
      throw new BadRequestException(`inputs.${input.name} (${input.label}, ${input.unit}) must be a decimal string`);
    }
    const value = new D(text.trim());
    if (input.greaterThan !== undefined && !value.greaterThan(input.greaterThan)) {
      throw new BadRequestException(`inputs.${input.name} must be > ${input.greaterThan}`);
    }
    if (input.atMost !== undefined && value.greaterThan(input.atMost)) {
      throw new BadRequestException(`inputs.${input.name} must be <= ${input.atMost}`);
    }
    values[input.name] = value;
  }
  const computed = definition.compute(values);
  return {
    inputs: definition.inputs.map((input) => ({ name: input.name, symbol: input.symbol, label: input.label, unit: input.unit, value: values[input.name]!.toString() })),
    outputs: definition.outputs.map((output) => ({
      name: output.name,
      symbol: output.symbol,
      label: output.label,
      unit: output.unit,
      value: computed.values[output.name]!.toDecimalPlaces(output.decimals, Prisma.Decimal.ROUND_HALF_UP).toFixed(output.decimals),
    })),
    formula: definition.formula,
    substitution: computed.substitution,
    assumptions: definition.assumptions,
    kernelVersion: KERNEL_VERSION,
  };
}
