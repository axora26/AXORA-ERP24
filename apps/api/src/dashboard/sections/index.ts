import type { DashboardSection } from "../section.js";
import { crmSection, salesSection } from "./commercial.js";
import { projectsSection } from "./projects.js";
import { procurementSection } from "./procurement.js";
import { inventorySection } from "./inventory.js";

/** Ordre d'affichage des indicateurs de la vue d'ensemble. */
export const DASHBOARD_SECTIONS: DashboardSection[] = [crmSection, salesSection, projectsSection, procurementSection, inventorySection];
