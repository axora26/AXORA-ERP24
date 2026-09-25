/** INC-05 — Projets & Construction. Montants : chaines decimales exactes (2 decimales). */

export type ProjectStatus = "PLANNED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type ProjectWbsKind = "LOT" | "PHASE" | "WORK_PACKAGE";
export type ProjectCostCategory = "MATERIAL" | "LABOR" | "EQUIPMENT" | "SUBCONTRACT" | "OVERHEAD" | "OTHER";
export type ProjectTaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export type ProjectChangeOrderStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ProjectRiskStatus = "OPEN" | "MITIGATED" | "CLOSED";

/**
 * Chaine budgetaire du projet. Chaque montant indique sa source : une valeur
 * alimentee par un module non encore livre est explicitement signalee
 * (`available: false`) plutot que presentee comme un zero reel.
 */
export interface ProjectBudgetFigure {
  amount: string;
  available: boolean;
  source: string;
}

export interface ProjectCockpitView {
  contractAmount: string;
  initialBudget: string;
  approvedChangeOrders: string;
  revisedBudget: string;
  /** Marge previsionnelle = montant contractuel - budget revise. */
  forecastMargin: string;
  committed: ProjectBudgetFigure;
  consumed: ProjectBudgetFigure;
  invoiced: ProjectBudgetFigure;
  paid: ProjectBudgetFigure;
  /** Cote client : facture emis et encaisse sur le projet (montants TTC). */
  billed: ProjectBudgetFigure;
  collected: ProjectBudgetFigure;
  /** Avancement physique derive des taches (0-100, 1 decimale). */
  physicalProgress: string;
  taskCounts: Record<ProjectTaskStatus, number>;
}

export interface ProjectSummaryView {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  clientName: string | null;
  location: string | null;
  currency: string;
  contractId: string | null;
  contractCode: string | null;
  contractAmount: string;
  revisedBudget: string;
  physicalProgress: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  budgetBaselinedAt: string | null;
  createdAt: string;
}

export interface ProjectWbsNodeView {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  kind: ProjectWbsKind;
  isLeaf: boolean;
  depth: number;
  /** Budget initial : lignes propres (feuille) ou somme derivee des feuilles descendantes. */
  initialBudget: string;
  revisedBudget: string;
  physicalProgress: string;
}

export interface ProjectBudgetLineView {
  id: string;
  wbsItemId: string;
  category: ProjectCostCategory;
  description: string;
  amount: string;
  createdAt: string;
}

export interface ProjectTaskView {
  id: string;
  wbsItemId: string;
  name: string;
  status: ProjectTaskStatus;
  weight: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  assigneeUserId: string | null;
  completedAt: string | null;
}

export interface ProjectMilestoneView {
  id: string;
  name: string;
  dueDate: string;
  status: "PLANNED" | "ACHIEVED";
  achievedAt: string | null;
  overdue: boolean;
}

export interface ProjectChangeOrderView {
  id: string;
  wbsItemId: string;
  code: string;
  title: string;
  reason: string;
  amount: string;
  status: ProjectChangeOrderStatus;
  requestedByUserId: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface ProjectRiskView {
  id: string;
  title: string;
  description: string | null;
  probability: number;
  impact: number;
  score: number;
  status: ProjectRiskStatus;
  mitigation: string | null;
  createdAt: string;
}

export interface ProjectDetailView extends ProjectSummaryView {
  description: string | null;
  statusReason: string | null;
  cockpit: ProjectCockpitView;
  wbs: ProjectWbsNodeView[];
  budgetLines: ProjectBudgetLineView[];
  tasks: ProjectTaskView[];
  milestones: ProjectMilestoneView[];
  changeOrders: ProjectChangeOrderView[];
  risks: ProjectRiskView[];
}
