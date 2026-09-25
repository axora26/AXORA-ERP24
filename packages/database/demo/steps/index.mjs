import { adminStep } from "./admin.mjs";
import { commercialStep } from "./commercial.mjs";
import { projectsStep } from "./projects.mjs";
import { procurementStep } from "./procurement.mjs";
import { inventoryStep } from "./inventory.mjs";
import { financeStep } from "./finance.mjs";
import { hrStep } from "./hr.mjs";
import { documentsStep } from "./documents.mjs";
import { fieldStep } from "./field.mjs";

/** Etapes executees dans l'ordre (les suivantes peuvent dependre du contexte des precedentes). */
export const DEMO_STEPS = [adminStep, commercialStep, projectsStep, procurementStep, inventoryStep, financeStep, hrStep, documentsStep, fieldStep];
