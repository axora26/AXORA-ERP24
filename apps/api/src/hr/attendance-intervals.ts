export interface AttendanceFact {
  id: string;
  employeeId: string;
  type: "IN" | "OUT";
  occurredAt: Date;
  projectId: string | null;
}
export interface AttendanceInterval {
  employeeId: string;
  attendanceInId: string;
  attendanceOutId: string | null;
  projectId: string | null;
  from: Date;
  to: Date | null;
  anomalies: string[];
}
/** Pair facts before filtering by project: an OUT may omit the IN's project. */
export function attendanceIntervals(events: AttendanceFact[], from: Date, to: Date): AttendanceInterval[] {
  const open = new Map<string, AttendanceFact>();
  const intervals: AttendanceInterval[] = [];
  const facts = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.type === b.type ? a.id.localeCompare(b.id) : a.type === "IN" ? -1 : 1));
  for (const event of facts) {
    if (event.type === "IN") {
      const prior = open.get(event.employeeId);
      if (prior && prior.occurredAt < to && event.occurredAt > from) intervals.push({ employeeId: prior.employeeId, attendanceInId: prior.id, attendanceOutId: null, projectId: prior.projectId, from: new Date(Math.max(from.getTime(), prior.occurredAt.getTime())), to: null, anomalies: ["MISSING_OUT_BEFORE_NEXT_IN"] });
      open.set(event.employeeId, event);
    } else {
      const entry = open.get(event.employeeId);
      if (!entry) continue;
      open.delete(event.employeeId);
      const start = Math.max(from.getTime(), entry.occurredAt.getTime());
      const end = Math.min(to.getTime(), event.occurredAt.getTime());
      if (end <= start) continue;
      intervals.push({ employeeId: entry.employeeId, attendanceInId: entry.id, attendanceOutId: event.id, projectId: entry.projectId, from: new Date(start), to: new Date(end), anomalies: event.projectId && entry.projectId !== event.projectId ? ["PROJECT_CHANGED_AT_OUT"] : [] });
    }
  }
  for (const entry of open.values()) if (entry.occurredAt < to) intervals.push({ employeeId: entry.employeeId, attendanceInId: entry.id, attendanceOutId: null, projectId: entry.projectId, from: new Date(Math.max(from.getTime(), entry.occurredAt.getTime())), to: null, anomalies: ["MISSING_OUT"] });
  return intervals;
}
export function splitIntervalUtc(interval: AttendanceInterval): Array<AttendanceInterval & { date: string; minutes: number }> {
  if (!interval.to) return [{ ...interval, date: interval.from.toISOString().slice(0, 10), minutes: 0 }];
  const rows: Array<AttendanceInterval & { date: string; minutes: number }> = [];
  let start = interval.from.getTime();
  while (start < interval.to.getTime()) {
    const day = new Date(start).toISOString().slice(0, 10);
    const end = Math.min(Date.parse(`${day}T00:00:00Z`) + 86_400_000, interval.to.getTime());
    rows.push({ ...interval, from: new Date(start), to: new Date(end), date: day, minutes: (end - start) / 60_000 });
    start = end;
  }
  return rows;
}
