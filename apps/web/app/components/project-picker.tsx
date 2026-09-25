"use client";

import React, { useEffect, useState } from "react";
import type { ProjectSummaryView } from "@axora24/contracts";
import { projectsApi } from "../lib/modules/projects";
import { useResource, type Resource } from "../lib/hooks";
import { SelectField } from "./ui";

const STORAGE_KEY = "axora.selected.project";

/**
 * Projet de travail partage entre les modules techniques (chantier, MEP,
 * commissioning, BIM...). Simple preference d'affichage, conservee sur
 * l'appareil ; le serveur revalide toujours le perimetre.
 */
export function useProjectChoice(): { projects: Resource<ProjectSummaryView[]>; projectId: string; setProjectId: (id: string) => void } {
  const projects = useResource(() => projectsApi.list());
  const [projectId, setProject] = useState("");

  useEffect(() => {
    const list = projects.data ?? [];
    if (projectId || list.length === 0) return;
    let stored = "";
    try {
      stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      stored = "";
    }
    const preferred = list.find((project) => project.id === stored) ?? list.find((project) => project.status === "IN_PROGRESS") ?? list[0];
    if (preferred) setProject(preferred.id);
  }, [projects.data, projectId]);

  function setProjectId(id: string): void {
    setProject(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Preference d'affichage uniquement.
    }
  }

  return { projects, projectId, setProjectId };
}

export function ProjectPicker({ projects, value, onChange }: { projects: ProjectSummaryView[]; value: string; onChange: (id: string) => void }): React.ReactElement {
  return (
    <div className="toolbar">
      <SelectField label="Projet" value={value} onChange={onChange} options={projects.map((project) => ({ value: project.id, label: `${project.code} — ${project.name}` }))} />
    </div>
  );
}
