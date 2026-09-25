"use client";

import React, { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Inbox, Loader2, RefreshCw, X } from "lucide-react";

/* ------------------------------------------------------------------------ */
/* Structure de page                                                         */
/* ------------------------------------------------------------------------ */

export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
  onRefresh,
}: {
  breadcrumb: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onRefresh?: () => void;
}): React.ReactElement {
  return (
    <section className="welcome-row">
      <div>
        <p className="breadcrumb">{breadcrumb}</p>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-actions">
        {actions}
        {onRefresh && (
          <button className="secondary-button" type="button" onClick={onRefresh}>
            <RefreshCw size={15} aria-hidden="true" />
            <span>Actualiser</span>
          </button>
        )}
      </div>
    </section>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <article className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </article>
  );
}

export function Grid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }): React.ReactElement {
  return <section className={`module-grid cols-${columns}`}>{children}</section>;
}

/* ------------------------------------------------------------------------ */
/* Indicateurs                                                               */
/* ------------------------------------------------------------------------ */

export type Tone = "blue" | "green" | "amber" | "violet" | "red";

export function Metrics({ children, label }: { children: ReactNode; label: string }): React.ReactElement {
  return (
    <section className="metrics-grid" aria-label={label}>
      {children}
    </section>
  );
}

export function Metric({
  icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string;
  detail?: string;
}): React.ReactElement {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div className="metric-label">{label}</div>
      <strong>{value}</strong>
      {detail && <small className={tone}>{detail}</small>}
    </article>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }): React.ReactElement {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-cell" aria-label={label ?? `Avancement ${bounded}%`}>
      <div>
        <i style={{ width: `${bounded}%` }} />
      </div>
      <span>{bounded.toFixed(0)}%</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Etats                                                                     */
/* ------------------------------------------------------------------------ */

export function Loading({ label }: { label: string }): React.ReactElement {
  return (
    <div className="crm-loading" role="status">
      <Loader2 size={20} className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({
  title,
  body,
  icon,
}: {
  title: string;
  body?: string;
  icon?: ReactNode;
}): React.ReactElement {
  return (
    <div className="empty-state">
      {icon ?? <Inbox size={22} aria-hidden="true" />}
      <strong>{title}</strong>
      {body && <small>{body}</small>}
    </div>
  );
}

export function Feedback({ error, notice }: { error?: string; notice?: string }): React.ReactElement | null {
  if (!error && !notice) return null;
  return (
    <>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="form-success" role="status">
          {notice}
        </div>
      )}
    </>
  );
}

export function StatusChip({ status, label }: { status: string; label?: string }): React.ReactElement {
  return <span className={`status-chip status-${status.toLowerCase()}`}>{label ?? status}</span>;
}

/* ------------------------------------------------------------------------ */
/* Tableau de donnees                                                        */
/* ------------------------------------------------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty,
  onRowClick,
  selectedId,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  empty: ReactNode;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  caption?: string;
}): React.ReactElement {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ textAlign: column.align ?? "left", width: column.width }}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`${onRowClick ? "clickable" : ""} ${selectedId === row.id ? "selected" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter") onRowClick(row);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} style={{ textAlign: column.align ?? "left" }}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Formulaires                                                               */
/* ------------------------------------------------------------------------ */

export function Form({
  onSubmit,
  children,
  submitLabel,
  saving,
  columns = 2,
  secondary,
}: {
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
  submitLabel: string;
  saving?: boolean;
  columns?: 1 | 2 | 3 | 4;
  secondary?: ReactNode;
}): React.ReactElement {
  function handle(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSubmit();
  }
  return (
    <form className={`module-form cols-${columns}`} onSubmit={handle}>
      {children}
      <div className="module-form-actions">
        <button className="primary-inline-button" type="submit" disabled={saving}>
          {saving ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
          {submitLabel}
        </button>
        {secondary}
      </div>
    </form>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  disabled?: boolean;
}

export function TextField({
  type = "text",
  inputMode,
  ...props
}: FieldProps & { type?: string; inputMode?: "decimal" | "numeric" | "email" | "text" }): React.ReactElement {
  const id = useId();
  return (
    <div className={`field ${props.wide ? "wide" : ""}`}>
      <label htmlFor={id}>
        {props.label}
        {props.required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        required={props.required}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
      {props.hint && <small className="field-note">{props.hint}</small>}
    </div>
  );
}

export function DecimalField(props: FieldProps): React.ReactElement {
  return <TextField {...props} inputMode="decimal" placeholder={props.placeholder ?? "0.00"} />;
}

export function DateField(props: FieldProps): React.ReactElement {
  return <TextField {...props} type="date" />;
}

export function TextAreaField(props: FieldProps & { rows?: number }): React.ReactElement {
  const id = useId();
  return (
    <div className="field wide">
      <label htmlFor={id}>
        {props.label}
        {props.required && <span aria-hidden="true"> *</span>}
      </label>
      <textarea
        id={id}
        rows={props.rows ?? 3}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        required={props.required}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
      {props.hint && <small className="field-note">{props.hint}</small>}
    </div>
  );
}

export function SelectField({
  options,
  emptyLabel,
  ...props
}: FieldProps & {
  options: Array<{ value: string; label: string }>;
  emptyLabel?: string;
}): React.ReactElement {
  const id = useId();
  return (
    <div className={`field ${props.wide ? "wide" : ""}`}>
      <label htmlFor={id}>
        {props.label}
        {props.required && <span aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        required={props.required}
        disabled={props.disabled}
      >
        <option value="">{emptyLabel ?? "— Sélectionner —"}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.hint && <small className="field-note">{props.hint}</small>}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Onglets, fenetre modale, liste de details                                 */
/* ------------------------------------------------------------------------ */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}): React.ReactElement {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === active}
          className={tab.id === active ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function DetailList({ items }: { items: Array<{ label: string; value: ReactNode }> }): React.ReactElement {
  return (
    <dl className="detail-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActionBar({ children, note }: { children: ReactNode; note?: string }): React.ReactElement {
  return (
    <div className="action-bar">
      {note && <p>{note}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}): React.ReactElement {
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}
