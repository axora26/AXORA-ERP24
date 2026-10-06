"use client";
import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api, ApiError } from "../lib/api";

export function FileDownloadButton({ path, filename, children, onError }: { path: string; filename: string; children: React.ReactNode; onError: (message: string) => void }): React.ReactElement {
  const [saving, setSaving] = useState(false);
  return <button type="button" className="secondary-button" disabled={saving} onClick={async () => {
    if (saving) return;
    setSaving(true); onError("");
    try {
      const file = await api.download(path);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename ?? filename; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { onError(caught instanceof ApiError ? caught.message : "Le téléchargement a échoué. Réessayez."); }
    finally { setSaving(false); }
  }}>{saving ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{children}</button>;
}
