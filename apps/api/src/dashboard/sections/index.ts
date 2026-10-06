import type { DashboardSection } from "../section.js";
import { crmSection, salesSection, quotesSection } from "./commercial.js";
import { projectsSection } from "./projects.js";
import { procurementSection, procurementRequestsSection } from "./procurement.js";
import { inventorySection } from "./inventory.js";
import { financeSection, payablesSection } from "./finance.js";
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
export const DASHBOARD_SECTIONS: DashboardSection[] = [crmSection, salesSection, quotesSection, projectsSection, procurementSection, procurementRequestsSection, inventorySection, financeSection, payablesSection, hrSection, fieldSection, qhseSection, assetsSection, smartSection, energySection, fleetSection, subcontractingSection, workflowSection, documentsSection];
