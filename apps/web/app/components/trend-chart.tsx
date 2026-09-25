import React from "react";

export interface TrendSample {
  ts: string;
  min: string;
  avg: string;
  max: string;
}

const WIDTH = 760;
const HEIGHT = 220;
const PAD = { top: 14, right: 16, bottom: 26, left: 52 };

function label(value: number, unit?: string | null): string {
  const text = Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(Math.abs(value) >= 100 ? 1 : 2);
  return `${text.replace(".", ",")}${unit ? ` ${unit}` : ""}`;
}

function time(value: number, spanMs: number): string {
  const date = new Date(value);
  return spanMs > 36 * 3_600_000
    ? date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
    : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Courbe de tendance SVG sans dependance : moyenne, enveloppe min/max
 * (series agregees), seuils en pointille. Les valeurs arrivent en chaines
 * decimales et ne sont converties qu'au dessin.
 */
export function TrendChart({
  series,
  unit,
  thresholds = [],
  from,
  to,
  ariaLabel,
}: {
  series: TrendSample[];
  unit?: string | null;
  thresholds?: Array<{ value: string; label: string; tone: "red" | "amber" | "blue" }>;
  from: string;
  to: string;
  ariaLabel: string;
}): React.ReactElement {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const span = Math.max(end - start, 1);
  const values = series.flatMap((sample) => [Number(sample.min), Number(sample.max)]).concat(thresholds.map((threshold) => Number(threshold.value)));
  if (series.length === 0) {
    return (
      <div className="trend-empty" role="img" aria-label={ariaLabel}>
        Aucune lecture sur la période.
      </div>
    );
  }
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low === high) {
    low -= 1;
    high += 1;
  }
  const margin = (high - low) * 0.08;
  low -= margin;
  high += margin;
  const x = (ts: string) => PAD.left + ((new Date(ts).getTime() - start) / span) * (WIDTH - PAD.left - PAD.right);
  const y = (value: string | number) => PAD.top + (1 - (Number(value) - low) / (high - low)) * (HEIGHT - PAD.top - PAD.bottom);
  const line = series.map((sample) => `${x(sample.ts).toFixed(1)},${y(sample.avg).toFixed(1)}`).join(" ");
  const aggregated = series.some((sample) => sample.min !== sample.max);
  const band = aggregated
    ? [...series.map((sample) => `${x(sample.ts).toFixed(1)},${y(sample.max).toFixed(1)}`), ...[...series].reverse().map((sample) => `${x(sample.ts).toFixed(1)},${y(sample.min).toFixed(1)}`)].join(" ")
    : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => low + (high - low) * ratio);
  return (
    <svg className="trend-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="grid" />
          <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
            {label(tick, null)}
          </text>
        </g>
      ))}
      {band && <polygon points={band} className="band" />}
      {thresholds.map((threshold) => (
        <g key={`${threshold.label}-${threshold.value}`}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(threshold.value)} y2={y(threshold.value)} className={`threshold ${threshold.tone}`} />
          <text x={WIDTH - PAD.right} y={y(threshold.value) - 4} textAnchor="end" className={`threshold-label ${threshold.tone}`}>
            {threshold.label} {label(Number(threshold.value), unit)}
          </text>
        </g>
      ))}
      <polyline points={line} className="line" />
      {series.length <= 60 && series.map((sample) => <circle key={sample.ts} cx={x(sample.ts)} cy={y(sample.avg)} r={2.4} className="dot" />)}
      <text x={PAD.left} y={HEIGHT - 6}>
        {time(start, span)}
      </text>
      <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end">
        {time(end, span)}
      </text>
    </svg>
  );
}
