"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import type { EmployeeView, LeaveRequestView } from "@axora24/contracts";
import { CalendarDays, CalendarOff, Clock, IdCard, LogIn, LogOut, Plus, QrCode, UserPlus, Users, Wallet } from "lucide-react";
import {
  CONTRACT_LABEL,
  EMPLOYEE_STATUS_LABEL,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  SOURCE_LABEL,
  TIMESHEET_STATUS_LABEL,
  hrApi,
  mondayOf,
} from "../../lib/modules/hr";
import { projectsApi } from "../../lib/modules/projects";
import { formatDate, formatMoney } from "../../lib/format";
import { useMutation, useResource } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import {
  Button,
  DataTable,
  DateField,
  DecimalField,
  Empty,
  Feedback,
  Form,
  Loading,
  Metric,
  Metrics,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  StatusChip,
  Tabs,
  TextAreaField,
  TextField,
} from "../../components/ui";

type TabId = "employees" | "attendance" | "timesheets" | "leaves" | "payroll";
type Dialog = "employee" | "department" | "timesheet" | "leave" | "payroll" | "attendance";

const LEAVE_CHIP: Record<string, string> = { REQUESTED: "pending", APPROVED: "approved", REJECTED: "rejected", CANCELLED: "cancelled" };

export default function HrPage(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const canPayroll = session.can("hr.payroll.read");
  const [tab, setTab] = useState<TabId>("employees");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [badgeFor, setBadgeFor] = useState<EmployeeView | null>(null);
  const [decision, setDecision] = useState<{ leave: LeaveRequestView; approve: boolean } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const mutation = useMutation();
  const data = useResource(() =>
    Promise.all([
      hrApi.employees(),
      hrApi.departments(),
      hrApi.attendance(today),
      hrApi.timesheets(),
      hrApi.leaves(),
      canPayroll ? hrApi.payrollRuns() : Promise.resolve([]),
    ]),
  );
  const [employees, departments, attendance, timesheets, leaves, payrollRuns] = data.data ?? [[], [], [], [], [], []];

  const presence = new Map<string, boolean>();
  for (const event of [...attendance].reverse()) presence.set(event.employeeId, event.type === "IN");
  const present = [...presence.values()].filter(Boolean).length;
  const active = employees.filter((employee) => employee.status === "ACTIVE");
  const toValidate = timesheets.filter((sheet) => sheet.status === "SUBMITTED").length;
  const pendingLeaves = leaves.filter((leave) => leave.status === "REQUESTED").length;
  const expiredSkills = employees.reduce((count, employee) => count + employee.skills.filter((skill) => skill.expired).length, 0);

  async function done(action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string): Promise<void> {
    const result = await mutation.run(action, success);
    if (result !== undefined) {
      setDialog(null);
      setDecision(null);
      if (open && result && typeof result === "object" && "id" in result) router.push(open(result as { id: string }));
      else await data.reload();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb="Ressources humaines"
        title="RH & temps"
        subtitle="Employés, pointages, feuilles de temps validées par un tiers, congés et préparation de paie — sans règle fiscale ou sociale présumée."
        onRefresh={() => void data.reload()}
        actions={
          <>
            {session.can("hr.leave.request") && (
              <Button onClick={() => setDialog("leave")}>
                <CalendarOff size={15} aria-hidden="true" /> Congé
              </Button>
            )}
            {session.can("hr.timesheet.manage") && (
              <Button onClick={() => setDialog("timesheet")}>
                <Clock size={15} aria-hidden="true" /> Feuille de temps
              </Button>
            )}
            {session.can("hr.employee.manage") && (
              <Button variant="primary" onClick={() => setDialog("employee")}>
                <UserPlus size={15} aria-hidden="true" /> Employé
              </Button>
            )}
          </>
        }
      />
      <Feedback error={data.error || mutation.error} notice={mutation.notice} />
      {data.loading && !data.data ? (
        <Loading label="Chargement des données RH…" />
      ) : (
        <>
          <Metrics label="Synthèse RH">
            <Metric icon={<Users size={20} />} tone="blue" label="Effectif actif" value={String(active.length)} detail={`${departments.length} département(s)`} />
            <Metric icon={<LogIn size={20} />} tone="green" label="Présents maintenant" value={String(present)} detail={`${attendance.length} pointage(s) aujourd'hui`} />
            <Metric
              icon={<Clock size={20} />}
              tone={toValidate + pendingLeaves > 0 ? "amber" : "green"}
              label="À valider"
              value={String(toValidate + pendingLeaves)}
              detail={`${toValidate} feuille(s) · ${pendingLeaves} congé(s)`}
            />
            <Metric icon={<IdCard size={20} />} tone={expiredSkills > 0 ? "red" : "green"} label="Habilitations expirées" value={String(expiredSkills)} detail="À renouveler avant affectation" />
          </Metrics>

          <Tabs<TabId>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "employees", label: "Employés", count: employees.length },
              { id: "attendance", label: "Présence du jour", count: attendance.length },
              { id: "timesheets", label: "Feuilles de temps", count: timesheets.length },
              { id: "leaves", label: "Congés", count: leaves.length },
              ...(canPayroll ? [{ id: "payroll" as const, label: "Paie", count: payrollRuns.length }] : []),
            ]}
          />

          <div className="stack">
            {tab === "employees" && (
              <Panel
                title="Employés"
                subtitle={canPayroll ? "Coûts horaires et salaires visibles avec la permission paie" : "Données salariales masquées (permission hr.payroll.read requise)"}
                actions={
                  session.can("hr.employee.manage") && (
                    <Button onClick={() => setDialog("department")}>
                      <Plus size={14} aria-hidden="true" /> Département
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={employees}
                  empty={<Empty icon={<Users size={22} />} title="Aucun employé" body="Enregistrez les collaborateurs pour gérer présence, temps et paie." />}
                  columns={[
                    {
                      key: "name",
                      header: "Employé",
                      render: (employee) => (
                        <>
                          <strong>{employee.fullName}</strong>
                          <small>
                            {employee.code} · {employee.jobTitle}
                            {employee.departmentName ? ` · ${employee.departmentName}` : ""}
                          </small>
                        </>
                      ),
                    },
                    { key: "contract", header: "Contrat", render: (employee) => `${CONTRACT_LABEL[employee.contractType]} · depuis ${formatDate(employee.hireDate)}` },
                    {
                      key: "skills",
                      header: "Habilitations",
                      render: (employee) =>
                        employee.skills.length === 0 ? (
                          "—"
                        ) : (
                          <span className="chip-row">
                            {employee.skills.map((skill) => (
                              <StatusChip key={skill.name} status={skill.expired ? "overdue" : "verified"} label={`${skill.name} · N${skill.level}`} />
                            ))}
                          </span>
                        ),
                    },
                    { key: "cost", header: "Coût horaire", align: "right", render: (employee) => (employee.hourlyCost === null ? "•••" : formatMoney(employee.hourlyCost, employee.currency)) },
                    {
                      key: "badge",
                      header: "Badge",
                      render: (employee) =>
                        employee.badgeCode ? (
                          <Button variant="ghost" onClick={() => setBadgeFor(employee)} title="Afficher le QR de pointage">
                            <QrCode size={14} aria-hidden="true" /> {employee.badgeCode}
                          </Button>
                        ) : (
                          "—"
                        ),
                    },
                    { key: "status", header: "Statut", render: (employee) => <StatusChip status={employee.status === "ACTIVE" ? "active" : employee.status === "SUSPENDED" ? "on_hold" : "closed"} label={EMPLOYEE_STATUS_LABEL[employee.status]} /> },
                  ]}
                />
              </Panel>
            )}

            {tab === "attendance" && (
              <div className="module-grid cols-2">
                {session.can("hr.attendance.create") && <BadgeTerminal onDone={() => void data.reload()} />}
                <Panel
                  title="Pointages du jour"
                  subtitle="Faits append-only : une erreur se corrige par un nouveau pointage, jamais par modification"
                  actions={
                    session.can("hr.attendance.create") && (
                      <Button onClick={() => setDialog("attendance")}>
                        <Plus size={14} aria-hidden="true" /> Saisie manuelle
                      </Button>
                    )
                  }
                >
                  <DataTable
                    rows={attendance}
                    empty={<Empty icon={<Clock size={22} />} title="Aucun pointage aujourd'hui" />}
                    columns={[
                      { key: "time", header: "Heure", render: (event) => new Date(event.occurredAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) },
                      { key: "who", header: "Employé", render: (event) => <strong>{event.employeeName}</strong> },
                      { key: "type", header: "Sens", render: (event) => <StatusChip status={event.type === "IN" ? "active" : "closed"} label={event.type === "IN" ? "Entrée" : "Sortie"} /> },
                      {
                        key: "source",
                        header: "Source",
                        render: (event) => (
                          <>
                            {SOURCE_LABEL[event.source]}
                            {event.projectCode && <small>{event.projectCode}</small>}
                          </>
                        ),
                      },
                    ]}
                  />
                </Panel>
              </div>
            )}

            {tab === "timesheets" && (
              <Panel title="Feuilles de temps" subtitle="Seules les heures validées par un tiers sont valorisées (coût projet) et prises en paie">
                <DataTable
                  rows={timesheets}
                  onRowClick={(sheet) => router.push(`/hr/timesheets/${sheet.id}`)}
                  empty={<Empty icon={<CalendarDays size={22} />} title="Aucune feuille de temps" />}
                  columns={[
                    { key: "who", header: "Employé", render: (sheet) => <strong>{sheet.employeeName}</strong> },
                    { key: "week", header: "Semaine du", render: (sheet) => formatDate(sheet.weekStart) },
                    { key: "hours", header: "Heures déclarées", align: "right", render: (sheet) => <span className="num">{sheet.totalHours} h</span> },
                    { key: "presence", header: "Heures pointées", align: "right", render: (sheet) => <span className="num">{sheet.attendanceHours} h</span> },
                    { key: "status", header: "Statut", render: (sheet) => <StatusChip status={sheet.status === "SUBMITTED" ? "pending" : sheet.status} label={TIMESHEET_STATUS_LABEL[sheet.status]} /> },
                  ]}
                />
              </Panel>
            )}

            {tab === "leaves" && (
              <Panel title="Congés et absences" subtitle="Jours ouvrés calculés par le serveur ; décision par une personne autre que le demandeur">
                <DataTable
                  rows={leaves}
                  empty={<Empty icon={<CalendarOff size={22} />} title="Aucune demande" />}
                  columns={[
                    {
                      key: "who",
                      header: "Employé",
                      render: (leave) => (
                        <>
                          <strong>{leave.employeeName}</strong>
                          <small>{LEAVE_TYPE_LABEL[leave.type]}</small>
                        </>
                      ),
                    },
                    { key: "period", header: "Période", render: (leave) => `${formatDate(leave.startDate)} → ${formatDate(leave.endDate)}` },
                    { key: "days", header: "Jours ouvrés", align: "right", render: (leave) => <span className="num">{leave.days}</span> },
                    { key: "status", header: "Statut", render: (leave) => <StatusChip status={LEAVE_CHIP[leave.status] ?? "pending"} label={LEAVE_STATUS_LABEL[leave.status]} /> },
                    {
                      key: "actions",
                      header: "",
                      align: "right",
                      render: (leave) =>
                        leave.status === "REQUESTED" && session.can("hr.leave.approve") ? (
                          <span className="chip-row">
                            <Button variant="ghost" onClick={() => setDecision({ leave, approve: false })}>
                              Refuser
                            </Button>
                            <Button onClick={() => setDecision({ leave, approve: true })}>Approuver</Button>
                          </span>
                        ) : null,
                    },
                  ]}
                />
              </Panel>
            )}

            {tab === "payroll" && (
              <Panel
                title="Préparation de paie"
                subtitle="Salaire de base + éléments variables saisis. Aucune retenue légale n'est calculée tant qu'aucun paramétrage pays n'existe."
                actions={
                  session.can("hr.payroll.manage") && (
                    <Button onClick={() => setDialog("payroll")}>
                      <Plus size={14} aria-hidden="true" /> Préparer un mois
                    </Button>
                  )
                }
              >
                <DataTable
                  rows={payrollRuns}
                  onRowClick={(run) => router.push(`/hr/payroll/${run.id}`)}
                  empty={<Empty icon={<Wallet size={22} />} title="Aucune paie préparée" />}
                  columns={[
                    { key: "period", header: "Période", render: (run) => <strong>{run.period}</strong> },
                    { key: "count", header: "Salariés", align: "right", render: (run) => String(run.lines.length) },
                    { key: "gross", header: "Brut total", align: "right", render: (run) => <span className="num">{formatMoney(run.totalGross, run.currency)}</span> },
                    { key: "status", header: "Statut", render: (run) => <StatusChip status={run.status === "DRAFT" ? "draft" : "closed"} label={run.status === "DRAFT" ? "En préparation" : `Clôturée le ${formatDate(run.closedAt)}`} /> },
                  ]}
                />
              </Panel>
            )}
          </div>
        </>
      )}

      {dialog && (
        <HrDialog
          dialog={dialog}
          employees={active}
          departments={departments.map((department) => ({ value: department.id, label: `${department.code} — ${department.name}` }))}
          saving={mutation.saving}
          error={mutation.error}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {decision && (
        <Modal title={decision.approve ? "Approuver le congé" : "Refuser le congé"} onClose={() => setDecision(null)}>
          <Feedback error={mutation.error} />
          <LeaveDecision
            leave={decision.leave}
            approve={decision.approve}
            saving={mutation.saving}
            onSubmit={(note) =>
              done(
                () => (decision.approve ? hrApi.approveLeave(decision.leave.id, note || undefined) : hrApi.rejectLeave(decision.leave.id, note)),
                decision.approve ? "Congé approuvé." : "Congé refusé.",
              )
            }
          />
        </Modal>
      )}
      {badgeFor && <BadgeModal employee={badgeFor} onClose={() => setBadgeFor(null)} />}
    </>
  );
}

/** Borne de pointage : identification par badge / QR / PIN puis evenement de presence. */
function BadgeTerminal({ onDone }: { onDone: () => void }): React.ReactElement {
  const [badge, setBadge] = useState("");
  const [source, setSource] = useState("BADGE");
  const mutation = useMutation();

  async function clock(type: "IN" | "OUT"): Promise<void> {
    if (!badge.trim()) return;
    const event = await mutation.run(() => hrApi.scan({ badgeCode: badge.trim(), type, source }), type === "IN" ? "Entrée enregistrée." : "Sortie enregistrée.");
    if (event) {
      setBadge("");
      onDone();
    }
  }

  return (
    <Panel title="Borne de pointage" subtitle="Scannez un badge, un QR code ou saisissez un code PIN">
      <div className="terminal">
        <Feedback error={mutation.error} notice={mutation.notice} />
        <SelectField
          label="Mode d'identification"
          value={source}
          onChange={setSource}
          options={[
            { value: "BADGE", label: "Badge" },
            { value: "QR", label: "QR code" },
            { value: "PIN", label: "Code PIN" },
          ]}
        />
        <TextField label="Identifiant" value={badge} onChange={setBadge} placeholder="Ex. BADGE-001" />
        <div className="terminal-actions">
          <Button variant="primary" onClick={() => void clock("IN")} disabled={mutation.saving || !badge.trim()}>
            <LogIn size={15} aria-hidden="true" /> Entrée
          </Button>
          <Button onClick={() => void clock("OUT")} disabled={mutation.saving || !badge.trim()}>
            <LogOut size={15} aria-hidden="true" /> Sortie
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function BadgeModal({ employee, onClose }: { employee: EmployeeView; onClose: () => void }): React.ReactElement {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (employee.badgeCode) void QRCode.toDataURL(employee.badgeCode, { margin: 1, width: 200 }).then(setSrc);
  }, [employee.badgeCode]);
  return (
    <Modal title={`Badge de pointage — ${employee.fullName}`} onClose={onClose}>
      <div className="badge-card">
        {src ? <img src={src} alt={`QR code du badge ${employee.badgeCode}`} width={200} height={200} /> : <Loading label="Génération du QR…" />}
        <strong>{employee.fullName}</strong>
        <span>
          {employee.code} · {employee.badgeCode}
        </span>
      </div>
    </Modal>
  );
}

function LeaveDecision({ leave, approve, saving, onSubmit }: { leave: LeaveRequestView; approve: boolean; saving: boolean; onSubmit: (note: string) => Promise<void> }): React.ReactElement {
  const [note, setNote] = useState("");
  return (
    <Form columns={1} submitLabel={approve ? "Approuver" : "Refuser"} saving={saving} onSubmit={() => onSubmit(note)}>
      <p className="inline-note">
        {leave.employeeName} — {LEAVE_TYPE_LABEL[leave.type]} du {formatDate(leave.startDate)} au {formatDate(leave.endDate)} ({leave.days} j ouvrés)
      </p>
      <TextAreaField label={approve ? "Commentaire" : "Motif du refus (obligatoire)"} value={note} onChange={setNote} required={!approve} />
    </Form>
  );
}

function HrDialog({
  dialog,
  employees,
  departments,
  saving,
  error,
  onClose,
  onDone,
}: {
  dialog: Dialog;
  employees: EmployeeView[];
  departments: Array<{ value: string; label: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onDone: (action: () => Promise<unknown>, success: string, open?: (result: { id: string }) => string) => Promise<void>;
}): React.ReactElement {
  const session = useSession();
  const [values, setValues] = useState<Record<string, string>>({
    contractType: "PERMANENT",
    hireDate: new Date().toISOString().slice(0, 10),
    weekStart: mondayOf(new Date()),
    type: dialog === "attendance" ? "IN" : "PAID",
    period: new Date().toISOString().slice(0, 7),
  });
  const set = (field: string) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  const value = (field: string) => values[field] ?? "";
  const decimal = (field: string) => value(field).replace(",", ".").trim() || undefined;
  const employeeOptions = employees.map((employee) => ({ value: employee.id, label: `${employee.fullName} (${employee.code})` }));
  const projects = useResource(
    () => (dialog === "attendance" && session.can("projects.project.read") ? projectsApi.list().catch(() => []) : Promise.resolve([])),
    [dialog],
  );

  let title = "";
  let body: React.ReactNode = null;
  switch (dialog) {
    case "employee":
      title = "Nouvel employé";
      body = (
        <Form
          submitLabel="Enregistrer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                hrApi.createEmployee({
                  firstName: value("firstName"),
                  lastName: value("lastName"),
                  jobTitle: value("jobTitle"),
                  hireDate: value("hireDate"),
                  contractType: value("contractType"),
                  departmentId: value("departmentId") || undefined,
                  email: value("email") || undefined,
                  phone: value("phone") || undefined,
                  badgeCode: value("badgeCode") || undefined,
                  hourlyCost: decimal("hourlyCost"),
                  baseSalary: decimal("baseSalary"),
                }),
              "Employé enregistré.",
            )
          }
        >
          <TextField label="Prénom" value={value("firstName")} onChange={set("firstName")} required />
          <TextField label="Nom" value={value("lastName")} onChange={set("lastName")} required />
          <TextField label="Fonction" value={value("jobTitle")} onChange={set("jobTitle")} required />
          <SelectField label="Département" value={value("departmentId")} onChange={set("departmentId")} options={departments} emptyLabel="Aucun" />
          <SelectField label="Contrat" value={value("contractType")} onChange={set("contractType")} required options={Object.entries(CONTRACT_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <DateField label="Date d'entrée" value={value("hireDate")} onChange={set("hireDate")} required />
          <TextField label="E-mail" value={value("email")} onChange={set("email")} />
          <TextField label="Téléphone" value={value("phone")} onChange={set("phone")} />
          <TextField label="Code badge / QR / PIN" value={value("badgeCode")} onChange={set("badgeCode")} hint="Identifiant unique utilisé par la borne de pointage." />
          {session.can("hr.payroll.manage") && (
            <>
              <DecimalField label="Coût horaire chargé" value={value("hourlyCost")} onChange={set("hourlyCost")} hint="Valorise les heures validées imputées aux projets." />
              <DecimalField label="Salaire de base mensuel brut" value={value("baseSalary")} onChange={set("baseSalary")} />
            </>
          )}
        </Form>
      );
      break;
    case "department":
      title = "Nouveau département";
      body = (
        <Form submitLabel="Créer" saving={saving} onSubmit={() => onDone(() => hrApi.createDepartment({ code: value("code"), name: value("name") }), "Département créé.")}>
          <TextField label="Code" value={value("code")} onChange={set("code")} required placeholder="TRV" />
          <TextField label="Nom" value={value("name")} onChange={set("name")} required placeholder="Travaux" />
        </Form>
      );
      break;
    case "timesheet":
      title = "Ouvrir une feuille de temps";
      body = (
        <Form
          submitLabel="Ouvrir"
          saving={saving}
          onSubmit={() =>
            onDone(() => hrApi.createTimesheet({ employeeId: value("employeeId"), weekStart: value("weekStart") }), "Feuille ouverte : saisissez les heures.", (result) => `/hr/timesheets/${result.id}`)
          }
        >
          <SelectField label="Employé" value={value("employeeId")} onChange={set("employeeId")} required options={employeeOptions} />
          <DateField label="Semaine (n'importe quel jour)" value={value("weekStart")} onChange={set("weekStart")} required hint="Ramenée automatiquement au lundi." />
        </Form>
      );
      break;
    case "leave":
      title = "Demande de congé";
      body = (
        <Form
          submitLabel="Demander"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                hrApi.requestLeave({
                  employeeId: value("employeeId"),
                  type: value("type"),
                  startDate: value("startDate"),
                  endDate: value("endDate"),
                  reason: value("reason") || undefined,
                }),
              "Demande enregistrée : elle sera décidée par un responsable.",
            )
          }
        >
          <SelectField label="Employé" value={value("employeeId")} onChange={set("employeeId")} required options={employeeOptions} />
          <SelectField label="Type" value={value("type")} onChange={set("type")} required options={Object.entries(LEAVE_TYPE_LABEL).map(([key, label]) => ({ value: key, label }))} />
          <DateField label="Du" value={value("startDate")} onChange={set("startDate")} required />
          <DateField label="Au (inclus)" value={value("endDate")} onChange={set("endDate")} required />
          <TextField label="Motif" value={value("reason")} onChange={set("reason")} wide />
        </Form>
      );
      break;
    case "attendance":
      title = "Saisie manuelle d'un pointage";
      body = (
        <Form
          submitLabel="Enregistrer"
          saving={saving}
          onSubmit={() =>
            onDone(
              () =>
                hrApi.recordAttendance({
                  employeeId: value("employeeId"),
                  type: value("type"),
                  occurredAt: value("occurredAt") ? new Date(value("occurredAt")).toISOString() : undefined,
                  projectId: value("projectId") || undefined,
                  note: value("note") || undefined,
                }),
              "Pointage enregistré.",
            )
          }
        >
          <SelectField label="Employé" value={value("employeeId")} onChange={set("employeeId")} required options={employeeOptions} />
          <SelectField
            label="Sens"
            value={value("type")}
            onChange={set("type")}
            required
            options={[
              { value: "IN", label: "Entrée" },
              { value: "OUT", label: "Sortie" },
            ]}
          />
          <TextField label="Date et heure (vide = maintenant)" value={value("occurredAt")} onChange={set("occurredAt")} placeholder="2026-09-25T07:30" />
          <SelectField label="Chantier" value={value("projectId")} onChange={set("projectId")} options={(projects.data ?? []).map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))} emptyLabel="Aucun" />
          <TextField label="Motif de la saisie manuelle" value={value("note")} onChange={set("note")} wide />
        </Form>
      );
      break;
    case "payroll":
      title = "Préparer la paie d'un mois";
      body = (
        <Form submitLabel="Préparer" saving={saving} onSubmit={() => onDone(() => hrApi.preparePayroll(value("period")), "Paie préparée.", (result) => `/hr/payroll/${result.id}`)}>
          <TextField label="Période (AAAA-MM)" value={value("period")} onChange={set("period")} required hint="Refusée tant qu'une feuille de temps de la période n'est pas validée." />
        </Form>
      );
      break;
  }

  return (
    <Modal title={title} onClose={onClose} wide={dialog === "employee"}>
      <Feedback error={error} />
      {body}
    </Modal>
  );
}
