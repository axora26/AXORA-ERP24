"use client";

import { AXORA_BRAND } from "@axora24/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./print-document.css";

const PRINT_CONTACT = `${AXORA_BRAND.phone} · ${AXORA_BRAND.email} · ${new URL(AXORA_BRAND.website).host}`;
const PRINT_MARGIN_STYLE = `@page {
  size: A4; margin: 15mm 14mm 24mm;
  @bottom-center {
    content: ${JSON.stringify(AXORA_BRAND.address)} "\\A" ${JSON.stringify(PRINT_CONTACT)};
    font: 8pt Inter, Arial, sans-serif; line-height: 1.45;
    white-space: pre; color: #4b5563;
    border-top: 1px solid #bfc3c9; vertical-align: middle;
  }
}`;

export function PrintDocument({ title, reference, companyName, demo = false, children }: {
  title: string; reference?: string; companyName?: string; demo?: boolean; children: ReactNode;
}): React.ReactElement {
  const marginStyle = useRef<HTMLStyleElement>(null);
  const [marginBoxes, setMarginBoxes] = useState(false);
  useEffect(() => {
    const rules = Array.from(marginStyle.current?.sheet?.cssRules ?? []);
    setMarginBoxes(rules.some(rule => {
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      return nested && Array.from(nested).some(child => "name" in child && child.name === "bottom-center");
    }));
  }, []);
  return <article className="axora-print-document" aria-label={title} data-print-margin-boxes={marginBoxes ? "supported" : "fallback"}>
    <style ref={marginStyle} media="print">{PRINT_MARGIN_STYLE}</style>
    <header className="axora-print-header">
      {/* The official transparent logo must also be available in browser print output. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={AXORA_BRAND.logoPath} alt={AXORA_BRAND.name} width={80} height={80} />
      <div><p className="axora-print-kicker">{AXORA_BRAND.name}</p><h1>{title}</h1>
        {reference && <p className="axora-print-reference">{reference}</p>}
        {companyName && <p>{companyName}</p>}
      </div>
    </header>
    {demo && <p className="axora-print-demo">DÉMONSTRATION — données fictives</p>}
    <section className="axora-print-content">{children}</section>
    <footer className="axora-print-footer"><p>{AXORA_BRAND.address}</p>
      <p>{PRINT_CONTACT}</p>
    </footer>
  </article>;
}
