import React from "react";
import { Command } from "lucide-react";

export function Brand(): React.ReactElement {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Command size={20} strokeWidth={2.4} />
      </span>
      <span className="brand-copy">
        <strong>AXORA</strong>
        <small>ERP24</small>
      </span>
    </div>
  );
}
