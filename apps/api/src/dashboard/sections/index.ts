import type { DashboardSection } from "../section.js";
import { crmSection, salesSection } from "./commercial.js";
import { projectsSection } from "./projects.js";
import { procurementSection } from "./procurement.js";
import { inventorySection } from "./inventory.js";
import { financeSection } from "./finance.js";
import { hrSection } from "./hr.js";
import { documentsSection, fieldSection } from "./field.js";
import { qhseSection } from "./qhse.js";
import { assetsSection } from "./assets.js";
import { smartSection } from "./smart.js";
import { energySection } from "./energy.js";
import { fleetSection } from "./fleet.js";
import { subcontractingSection } from "./subcontracting.js";
import { workflowSection } from "./workflow.js";

/** Ordre d'affichage des indicateurs de la vue d'ensemble. */
export const DASHBOARD_SECTIONS: DashboardSection[] = [crmSection, salesSection, projectsSection, procurementSection, inventorySection, financeSection, hrSection, fieldSection, qhseSection, assetsSection, smartSection, energySection, fleetSection, subcontractingSection, workflowSection, documentsSection];
