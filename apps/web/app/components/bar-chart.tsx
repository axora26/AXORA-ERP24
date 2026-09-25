import React from "react";

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

const WIDTH = 760;
const HEIGHT = 230;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };

function short(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(0)} k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(".", ",")} k`;
  return value.toFixed(value >= 100 ? 0 : 1).replace(".", ",");
}

/** Barres empilees SVG sans dependance (valeurs en chaines decimales converties au dessin uniquement). */
export function StackedBars({
  rows,
  series,
  unit,
  ariaLabel,
}: {
  rows: Array<{ label: string; values: Partial<Record<string, string>> }>;
  series: BarSeries[];
  unit: string;
  ariaLabel: string;
}): React.ReactElement {
  const totals = rows.map((row) => series.reduce((total, serie) => total + Number(row.values[serie.key] ?? 0), 0));
  const max = Math.max(...totals, 0);
  if (max === 0) {
    return (
      <div className="trend-empty" role="img" aria-label={ariaLabel}>
        Aucune donnée sur la période.
      </div>
    );
  }
  const top = max * 1.08;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const slot = plotWidth / rows.length;
  const barWidth = Math.max(4, Math.min(38, slot * 0.62));
  const y = (value: number) => PAD.top + (1 - value / top) * (HEIGHT - PAD.top - PAD.bottom);
  const labelEvery = Math.ceil(rows.length / 10);
  return (
    <figure className="stacked-bars">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(top * ratio)} y2={y(top * ratio)} className="grid" />
            <text x={PAD.left - 6} y={y(top * ratio) + 3} textAnchor="end">
              {short(top * ratio)}
            </text>
          </g>
        ))}
        {rows.map((row, index) => {
          let base = 0;
          const x = PAD.left + slot * index + (slot - barWidth) / 2;
          return (
            <g key={row.label}>
              {series.map((serie) => {
                const value = Number(row.values[serie.key] ?? 0);
                if (value <= 0) return null;
                const rect = <rect key={serie.key} x={x} width={barWidth} y={y(base + value)} height={y(base) - y(base + value)} fill={serie.color}><title>{`${row.label} — ${serie.label} : ${value.toLocaleString("fr-FR")} ${unit}`}</title></rect>;
                base += value;
                return rect;
              })}
              {index % labelEvery === 0 && (
                <text x={x + barWidth / 2} y={HEIGHT - 10} textAnchor="middle">
                  {row.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={PAD.left} y={PAD.top - 2} className="unit">
          {unit}
        </text>
      </svg>
      <figcaption className="stacked-legend">
        {series.map((serie) => (
          <span key={serie.key}>
            <i style={{ background: serie.color }} aria-hidden="true" /> {serie.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
