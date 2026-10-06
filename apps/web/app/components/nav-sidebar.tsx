"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Star } from "lucide-react";
import { isActive, navGroupId, type NavGroup, type NavItem } from "../lib/navigation";

const FAVORITES_KEY = "axora.nav.favorites";

function readFavoriteHrefs(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readGroupState(group: NavGroup): boolean {
  try {
    return window.localStorage.getItem(`axora.nav.group.${navGroupId(group.label)}`) === "true";
  } catch {
    return false;
  }
}

function NavEntry({
  item,
  pathname,
  favorite,
  onFavorite,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  favorite: boolean;
  onFavorite: (item: NavItem) => void;
  onNavigate: () => void;
}): React.ReactElement {
  const active = isActive(pathname, item.href);
  return (
    <div className="nav-entry">
      <Link
        href={item.href}
        className={active ? "active" : ""}
        aria-current={active ? "page" : undefined}
        aria-label={item.label}
        title={item.label}
        onClick={onNavigate}
      >
        <item.icon size={18} aria-hidden="true" />
        <span>{item.label}</span>
        {active && <i aria-hidden="true" />}
      </Link>
      <button
        type="button"
        className="nav-favorite"
        aria-label={`${favorite ? "Retirer" : "Ajouter"} ${item.label} ${favorite ? "des" : "aux"} favoris`}
        aria-pressed={favorite}
        title={`${favorite ? "Retirer des" : "Ajouter aux"} favoris`}
        onClick={() => onFavorite(item)}
      >
        <Star size={15} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </div>
  );
}

export function NavSidebar({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate: () => void;
}): React.ReactElement {
  const activeGroup = groups.find((group) => group.items.some((item) => isActive(pathname, item.href)))?.label;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((group) => [group.label, group.label === activeGroup])),
  );
  const [favoriteHrefs, setFavoriteHrefs] = useState<string[]>([]);
  const visibleItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const favoriteItems = favoriteHrefs
    .map((href) => visibleItems.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item));

  useEffect(() => {
    setOpenGroups(Object.fromEntries(groups.map((group) => [group.label, group.label === activeGroup || readGroupState(group)])));
    setFavoriteHrefs(readFavoriteHrefs());
  }, [groups, activeGroup]);

  function toggleGroup(group: NavGroup): void {
    setOpenGroups((current) => {
      const open = !(current[group.label] ?? false);
      try {
        window.localStorage.setItem(`axora.nav.group.${navGroupId(group.label)}`, String(open));
      } catch {
        // La navigation reste utilisable si le stockage navigateur est indisponible.
      }
      return { ...current, [group.label]: open };
    });
  }

  function toggleFavorite(item: NavItem): void {
    setFavoriteHrefs((current) => {
      const next = current.includes(item.href) ? current.filter((href) => href !== item.href) : [...current, item.href];
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        // Le favori reste actif pour l'onglet courant si le stockage est indisponible.
      }
      return next;
    });
  }

  const renderedGroups: Array<NavGroup & { favorite?: boolean }> = favoriteItems.length > 0
    ? [{ label: "Favoris", items: favoriteItems, favorite: true }, ...groups]
    : groups;

  return (
    <nav aria-label="Navigation principale">
      {renderedGroups.map((group) => {
        const groupId = group.favorite ? "favorites" : navGroupId(group.label);
        const controls = `nav-group-${groupId}`;
        const open = group.favorite ? true : (openGroups[group.label] ?? false);
        return (
          <section className="nav-group" key={group.favorite ? "favorites" : group.label}>
            <button
              type="button"
              className="nav-group-toggle"
              aria-expanded={open}
              aria-controls={controls}
              aria-label={group.label}
              title={group.label}
              onClick={() => !group.favorite && toggleGroup(group)}
            >
              {group.favorite && <Star size={14} fill="currentColor" aria-hidden="true" />}
              <span>{group.label}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div id={controls} className="nav-group-items" hidden={!open}>
              {group.items.map((item) => (
                <NavEntry
                  key={`${groupId}-${item.href}`}
                  item={item}
                  pathname={pathname}
                  favorite={favoriteHrefs.includes(item.href)}
                  onFavorite={toggleFavorite}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        );
      })}
    </nav>
  );
}
