import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Portail AXORA" };

/** Portail externe : mise en page distincte, sans le shell ni la navigation interne. */
export default function PortalLayout({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="portal-root">{children}</div>;
}
