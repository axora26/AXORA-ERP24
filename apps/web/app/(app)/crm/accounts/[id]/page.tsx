"use client";

import React from "react";
import { useParams } from "next/navigation";
import { CrmAccount360 } from "../../../../components/crm-account-360";

export default function CrmAccountPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  return <CrmAccount360 accountId={id} />;
}
