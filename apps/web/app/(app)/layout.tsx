import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";

/** Toutes les routes de ce groupe exigent une session valide (AppShell). */
export default function AuthenticatedLayout({ children }: { children: ReactNode }): React.ReactElement {
  return <AppShell>{children}</AppShell>;
}
