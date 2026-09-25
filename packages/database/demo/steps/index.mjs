import { adminStep } from "./admin.mjs";
import { commercialStep } from "./commercial.mjs";
import { projectsStep } from "./projects.mjs";
import { procurementStep } from "./procurement.mjs";
import { inventoryStep } from "./inventory.mjs";
import { financeStep } from "./finance.mjs";
import { hrStep } from "./hr.mjs";
import { documentsStep } from "./documents.mjs";
import { fieldStep } from "./field.mjs";
import { qhseStep } from "./qhse.mjs";
import { commissioningStep, mepStep } from "./mep.mjs";
import { bimStep } from "./bim.mjs";
import { assetsStep } from "./assets.mjs";
import { smartStep } from "./smart.mjs";
import { energyStep } from "./energy.mjs";
import { fleetStep } from "./fleet.mjs";

/** Etapes executees dans l'ordre (les suivantes peuvent dependre du contexte des precedentes). */
export const DEMO_STEPS = [adminStep, commercialStep, projectsStep, procurementStep, inventoryStep, financeStep, hrStep, documentsStep, fieldStep, qhseStep, mepStep, commissioningStep, bimStep, assetsStep, smartStep, energyStep, fleetStep];
