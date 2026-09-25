import type { DashboardSection } from "../section.js";
import { crmSection, salesSection } from "./commercial.js";
import { projectsSection } from "./projects.js";
import { procurementSection } from "./procurement.js";

/** Ordre d'affichage des indicateurs de la vue d'ensemble. */
export const DASHBOARD_SECTIONS: DashboardSection[] = [crmSection, salesSection, projectsSection, procurementSection];
