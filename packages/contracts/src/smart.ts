/**
 * INC-16 — Smart Building / GTB / BMS / IoT.
 * Les cinq niveaux de connectivite ne sont jamais fusionnes ; une passerelle
 * de simulation n'est jamais une preuve de communication physique.
 */

export type SmartProtocol = "HTTP_API" | "MQTT" | "BACNET_IP" | "MODBUS_TCP" | "KNX_IP";
export type SmartPointKind = "ANALOG" | "BINARY" | "MULTISTATE";
export type SmartReadingQuality = "GOOD" | "UNCERTAIN" | "BAD";
export type SmartAlarmCondition = "ABOVE" | "BELOW" | "EQUALS";
export type SmartAlarmSeverity = "INFO" | "WARNING" | "CRITICAL";
export type SmartAlarmStatus = "ACTIVE" | "ACKNOWLEDGED" | "CLEARED";
export type SmartSetpointStatus = "REQUESTED" | "DISPATCHED" | "ACKNOWLEDGED" | "CONFIRMED" | "FAILED" | "CANCELLED";

/** YES : preuve disponible ; NO : pas developpe ; NOT_TESTED : jamais exerce ; SIMULATED : passerelle de simulation. */
export type ConnectivityState = "YES" | "NO" | "NOT_TESTED" | "SIMULATED";

export interface ConnectivityLevel {
  key: "protocol" | "connector" | "network" | "read" | "write";
  label: string;
  state: ConnectivityState;
  detail: string;
  evidenceAt: string | null;
}

export interface SmartBuildingView {
  id: string;
  code: string;
  name: string;
  address: string | null;
  projectId: string | null;
  projectCode: string | null;
  floorAreaM2: string | null;
  gateways: number;
  points: number;
  activeAlarms: number;
}

export interface SmartGatewayTestView {
  id: string;
  pointId: string;
  pointName: string;
  kind: "READ" | "WRITE";
  referenceValue: string | null;
  tolerance: string | null;
  observedValue: string;
  observedAt: string;
  setpointId: string | null;
  outcome: "PASS" | "FAIL";
  evidence: string;
  performedByName: string;
  performedAt: string;
}

export interface SmartGatewayView {
  id: string;
  code: string;
  name: string;
  buildingId: string;
  buildingCode: string;
  protocol: SmartProtocol;
  endpoint: string | null;
  simulated: boolean;
  tokenPrefix: string;
  active: boolean;
  lastSeenAt: string | null;
  points: number;
  readings24h: number;
  levels: ConnectivityLevel[];
  tests?: SmartGatewayTestView[];
}

/** Reponse de creation / rotation : le jeton n'est montre qu'une seule fois. */
export interface SmartGatewayTokenView {
  gateway: SmartGatewayView;
  token: string;
}

export interface SmartPointView {
  id: string;
  gatewayId: string;
  gatewayCode: string;
  buildingCode: string;
  simulated: boolean;
  externalRef: string;
  name: string;
  kind: SmartPointKind;
  unit: string | null;
  assetId: string | null;
  assetCode: string | null;
  writable: boolean;
  writeTolerance: string | null;
  minPlausible: string | null;
  maxPlausible: string | null;
  lastValue: string | null;
  lastReadingAt: string | null;
  stale: boolean;
  active: boolean;
  activeAlarms: number;
}

export interface SmartTrendPoint {
  ts: string;
  min: string;
  avg: string;
  max: string;
  count: number;
}

export interface SmartTrendView {
  pointId: string;
  from: string;
  to: string;
  bucket: "raw" | "hour";
  series: SmartTrendPoint[];
  badReadings: number;
}

export interface SmartAlarmRuleView {
  id: string;
  pointId: string;
  condition: SmartAlarmCondition;
  threshold: string;
  severity: SmartAlarmSeverity;
  message: string;
  active: boolean;
}

export interface SmartAlarmView {
  id: string;
  ruleId: string;
  pointId: string;
  pointName: string;
  pointRef: string;
  unit: string | null;
  gatewayCode: string;
  buildingCode: string;
  condition: SmartAlarmCondition;
  threshold: string;
  severity: SmartAlarmSeverity;
  message: string;
  triggerValue: string;
  triggerReadingAt: string;
  raisedAt: string;
  status: SmartAlarmStatus;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  acknowledgeNote: string | null;
  clearedAt: string | null;
  clearValue: string | null;
}

export interface SmartSetpointView {
  id: string;
  pointId: string;
  pointName: string;
  unit: string | null;
  requestedValue: string;
  reason: string;
  requestedByName: string;
  requestedAt: string;
  status: SmartSetpointStatus;
  dispatchedAt: string | null;
  acknowledgedAt: string | null;
  gatewayNote: string | null;
  confirmedAt: string | null;
  confirmReadingAt: string | null;
  confirmValue: string | null;
}

export interface SmartPointDetailView extends SmartPointView {
  rules: SmartAlarmRuleView[];
  alarms: SmartAlarmView[];
  setpoints: SmartSetpointView[];
  recent: Array<{ ts: string; value: string; quality: SmartReadingQuality }>;
}

/** Resultat d'ingestion : chaque lecture est acceptee, doublon, conflit ou rejetee — jamais silencieusement ecrasee. */
export interface SmartIngestResult {
  accepted: number;
  duplicates: number;
  conflicts: Array<{ ref: string; ts: string; value: string; existing: string }>;
  rejected: Array<{ index: number; reason: string }>;
  alarmsRaised: number;
  alarmsCleared: number;
  setpointsConfirmed: number;
}

export interface SmartSummaryView {
  buildings: number;
  gateways: number;
  simulatedGateways: number;
  physicalReadTested: number;
  physicalWriteTested: number;
  points: number;
  stalePoints: number;
  activeAlarms: number;
  criticalAlarms: number;
  pendingSetpoints: number;
  readings24h: number;
}
