"use client";
import React from "react";
import Link from "next/link";
import { PayrollPolicy } from "../../../components/payroll-policy";
import { Feedback, PageHeader } from "../../../components/ui";
import { useSession } from "../../../lib/session";

export default function PayrollPolicyPage(): React.ReactElement {
  const session = useSession();
  const allowed = session.can("hr.payroll.read") || session.can("hr.payrollpolicy.manage");
  return <><PageHeader breadcrumb="Ressources humaines / Règles de paie" title="Règles de préparation de paie" subtitle="Paramètres de calcul des prochaines préparations" actions={session.can("hr.employee.read") && <Link className="btn btn-secondary" href="/hr">Retour aux RH</Link>} />{allowed ? <PayrollPolicy /> : <Feedback error="L’accès aux règles de paie nécessite une permission de lecture de la paie ou de configuration des règles." />}</>;
}
