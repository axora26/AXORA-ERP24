import type { DashboardSection } from "../section.js";
import { crmSection, salesSection } from "./commercial.js";

/** Ordre d'affichage des indicateurs de la vue d'ensemble. */
export const DASHBOARD_SECTIONS: DashboardSection[] = [crmSection, salesSection];
