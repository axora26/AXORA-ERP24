"use client";

import React, { useState } from "react";

export interface MonthlySeries {
  key: string;
  label: string;
  values: string[];
}

/** Palette categorielle validee (3 emplacements, ordre fixe, jamais cycle). */
const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
const WIDTH = 560;
const HEIGHT = 190;
const PAD = { top: 12, right: 8, bottom: 24, left: 52 };
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function monthLabel(month: string): string {
  const [year, index] = month.split("-");
  return `${MONTHS[Number(index) - 1]} ${year!.slice(2)}`;
}

export function formatValue(value: number, unit: string): string {
  const text = value.toLocaleString("fr-FR", { maximumFractionDigits: unit === "count" ? 0 : 2, minimumFractionDigits: 0 });
  return unit ? `${text} ${unit}` : text;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value)!;
  return step * magnitude;
}

function short(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
}

/** Barre a sommet arrondi (4 px), ancree sur la ligne de base. */
function bar(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`;
}

/**
 * Barres mensuelles groupees : un axe unique, au plus 3 series (identite par
 * couleur ET legende), infobulle au survol d'un mois, vue tableau equivalente.
 * Les series de devises differentes ne doivent jamais etre passees ensemble.
 */
export function MonthlyChart({ months, series, unit, ariaLabel }: { months: string[]; series: MonthlySeries[]; unit: string; ariaLabel: string }): React.ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const shown = series.slice(0, SERIES_COLORS.length);
  const numbers = shown.map((serie) => serie.values.map(Number));
  const top = niceMax(Math.max(0, ...numbers.flat()));
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const column = plotWidth / months.length;
  const barWidth = Math.max(3, (column * 0.72 - 2 * (shown.length - 1)) / Math.max(1, shown.length));
  const y = (value: number) => PAD.top + (1 - value / top) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * top);

  return (
    <div className="monthly-chart">
      {shown.length > 1 && (
        <ul className="monthly-legend">
          {shown.map((serie, index) => (
            <li key={serie.key}>
              <i style={{ background: SERIES_COLORS[index] }} aria-hidden="true" /> {serie.label}
            </li>
          ))}
        </ul>
      )}
      {table ? (
        <div className="monthly-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Mois</th>
                {shown.map((serie) => (
                  <th key={serie.key} scope="col">
                    {serie.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((month, index) => (
                <tr key={month}>
                  <th scope="row">{monthLabel(month)}</th>
                  {numbers.map((values, serieIndex) => (
                    <td key={shown[serieIndex]!.key}>{formatValue(values[index]!, unit)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="monthly-plot" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label={ariaLabel}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "baseline" : "grid"} />
                <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
                  {short(tick)}
                </text>
              </g>
            ))}
            {months.map((month, index) => {
              const x0 = PAD.left + index * column + (column - (barWidth * shown.length + 2 * (shown.length - 1))) / 2;
              return (
                <g key={month}>
                  {hover === index && <rect x={PAD.left + index * column} y={PAD.top} width={column} height={plotHeight} className="hover-band" />}
                  {numbers.map((values, serieIndex) => {
                    const value = values[index]!;
                    const x = x0 + serieIndex * (barWidth + 2);
                    return <path key={shown[serieIndex]!.key} d={bar(x, y(value), barWidth, y(0) - y(value))} fill={SERIES_COLORS[serieIndex]} />;
                  })}
                  {(index % Math.ceil(months.length / 12) === 0 || index === months.length - 1) && (
                    <text x={PAD.left + index * column + column / 2} y={HEIGHT - 7} textAnchor="middle">
                      {monthLabel(month)}
                    </text>
                  )}
                  <rect x={PAD.left + index * column} y={PAD.top} width={column} height={plotHeight} fill="transparent" onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} role="img" aria-label={`${monthLabel(month)} : ${shown.map((serie, serieIndex) => `${serie.label} ${formatValue(numbers[serieIndex]![index]!, unit)}`).join(", ")}`} />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="monthly-tooltip" style={{ left: `${((PAD.left + (hover + 0.5) * column) / WIDTH) * 100}%` }} role="status">
              <strong>{monthLabel(months[hover]!)}</strong>
              {shown.map((serie, serieIndex) => (
                <span key={serie.key}>
                  {shown.length > 1 && (
                    <>
                      <i style={{ background: SERIES_COLORS[serieIndex] }} aria-hidden="true" /> {serie.label} :{" "}
                    </>
                  )}
                  {formatValue(numbers[serieIndex]![hover]!, unit)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" className="monthly-toggle" onClick={() => setTable((value) => !value)}>
        {table ? "Voir le graphique" : "Voir le tableau"}
      </button>
    </div>
  );
}
