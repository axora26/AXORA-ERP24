"use client";

import React from "react";
import type { SiteEvidenceView } from "@axora24/contracts";
import { assetUrl } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { StatusChip } from "./ui";

/** Frise des preuves horodatees (append-only) : prise de vue, reception serveur, auteur, GPS. */
export function EvidenceTimeline({ items }: { items: SiteEvidenceView[] }): React.ReactElement {
  return (
    <ol className="evidence-timeline">
      {items.map((item) => (
        <li key={item.id} className={`kind-${item.kind.toLowerCase()}`}>
          {item.file && (
            <a href={assetUrl(item.file.url)} target="_blank" rel="noreferrer">
              <img src={assetUrl(item.file.url)} alt={item.note ?? "Photo"} loading="lazy" />
            </a>
          )}
          <div>
            <StatusChip status={item.kind === "CORRECTION" ? "done" : item.kind === "PHOTO" ? "in_progress" : "draft"} label={item.kind === "CORRECTION" ? "Correction" : item.kind === "PHOTO" ? "Photo" : "Observation"} />
            {item.note && <p>{item.note}</p>}
            <small>
              Prise le {formatDateTime(item.takenAt)} · reçue le {formatDateTime(item.recordedAt)} · {item.createdByName}
              {item.latitude && item.longitude ? ` · GPS ${item.latitude}, ${item.longitude}` : ""}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}
