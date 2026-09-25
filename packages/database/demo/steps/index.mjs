import { adminStep } from "./admin.mjs";
import { commercialStep } from "./commercial.mjs";
import { projectsStep } from "./projects.mjs";
import { procurementStep } from "./procurement.mjs";

/** Etapes executees dans l'ordre (les suivantes peuvent dependre du contexte des precedentes). */
export const DEMO_STEPS = [adminStep, commercialStep, projectsStep, procurementStep];
