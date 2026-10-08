import React from "react";
import Link from "next/link";
import { activeNavigation } from "../lib/navigation";

function labelSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Un segment mal encodé reste affiché tel quel plutôt que de casser le shell.
  }
  if (/^[A-Z0-9_-]+$/.test(decoded)) return decoded;
  const words = decoded.replace(/[-_]+/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function NavBreadcrumbs({
  pathname,
}: {
  pathname: string;
}): React.ReactElement | null {
  const active = activeNavigation(pathname);
  if (!active) return null;

  const baseSegments = active.item.href.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  const remainder = pathSegments.slice(baseSegments.length);
  const crumbs = [
    { label: active.group.label },
    {
      label: active.item.label,
      href: remainder.length > 0 ? active.item.href : undefined,
    },
    // Un segment intermédiaire n'est pas nécessairement une page existante.
    // Seule l'entrée de navigation connue ci-dessus est un lien de retour.
    ...remainder.map((segment) => ({ label: labelSegment(segment) })),
  ];

  return (
    <nav className="app-breadcrumb" aria-label="Fil d’Ariane">
      <ol>
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`}>
              {crumb.href && !current ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span aria-current={current ? "page" : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
