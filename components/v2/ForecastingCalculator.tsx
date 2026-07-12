'use client';

// Financial forecasting — interactive scenario calculator (client).
//
// Computes the projection LIVE and deterministically from the pure model
// (lib/forecasting/model.ts) as the controls move — no round-trip needed for the
// numbers. The only server call is the OPTIONAL Hermes narrative (POST the
// current inputs, ask for interpretation), which degrades gracefully when the
// Brain is off. Read-only/advisory throughout: nothing here mutates anything.

import { useMemo, useState } from 'react';
import { project, type ForecastInputs, type Forecast } from '@/lib/forecasting/model';
import { baselineInputs, PRESETS } from '@/lib/forecasting/scenarios';
import type { TierLine } from '@/lib/forecasting/tiers';

const gbp0 = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })
    : '∞';
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const runwayLabel = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)} mo` : '∞');

type Patch = Partial<Omit<ForecastInputs, 'tierMix'>>;

export function ForecastingCalculator({
  initial,
  brainEnabled,
}: {
  initial: ForecastInputs;
  brainEnabled: boolean;
}) {
  const [inputs, setInputs] = useState<ForecastInputs>(initial);
  const [activePreset, setActivePreset] = useState<string>('baseline');
  // Compare slot: a frozen snapshot of a second scenario, side by side.
  const [compare, setCompare] = useState<{ label: string; forecast: Forecast } | null>(null);

  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrErr, setNarrErr] = useState<string | null>(null);
  const [narrBusy, setNarrBusy] = useState(false);

  const forecast = useMemo(() => project(inputs), [inputs]);

  function setField(patch: Patch) {
    setInputs((prev) => ({ ...prev, ...patch }));
    setActivePreset('custom');
    setNarrative(null);
    setNarrErr(null);
  }

  function setTierCustomers(id: string, customers: number) {
    setInputs((prev) => ({
      ...prev,
      tierMix: prev.tierMix.map((t) => (t.id === id ? { ...t, customers } : t)),
    }));
    setActivePreset('custom');
    setNarrative(null);
  }

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setInputs(preset.apply(baselineInputs()));
    setActivePreset(id);
    setNarrative(null);
    setNarrErr(null);
  }

  function reset() {
    setInputs(baselineInputs());
    setActivePreset('baseline');
    setNarrative(null);
    setNarrErr(null);
    setCompare(null);
  }

  function pinCompare() {
    const label = PRESETS.find((p) => p.id === activePreset)?.label ?? 'Custom';
    setCompare({ label, forecast });
  }

  async function askNarrative() {
    setNarrBusy(true);
    setNarrErr(null);
    setNarrative(null);
    try {
      const label = PRESETS.find((p) => p.id === activePreset)?.label ?? 'Custom scenario';
      const res = await fetch('/api/v2/admin/forecasting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, scenarioLabel: label, withNarrative: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNarrErr(data?.error ?? `Request failed (${res.status})`);
      } else if (data?.narrative?.enabled && data.narrative.text) {
        setNarrative(data.narrative.text);
      } else if (data?.narrative?.error) {
        setNarrErr(data.narrative.error);
      } else {
        setNarrErr('Hermes Brain is disabled — set HERMES_BRAIN_ENABLED to enable the narrative.');
      }
    } catch (e: any) {
      setNarrErr(e?.message ?? 'Network error');
    } finally {
      setNarrBusy(false);
    }
  }

  const s = forecast.summary;
  const runwayTone = !Number.isFinite(s.runwayMonths)
    ? 'ok'
    : s.runwayMonths < 6
      ? 'crit'
      : s.runwayMonths < 12
        ? 'high'
        : 'ok';

  return (
    <div className="fc-wrap">
      {/* Preset row */}
      <div className="fc-presets" role="group" aria-label="Scenario presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`fc-preset${activePreset === p.id ? ' active' : ''}`}
            title={p.description}
            onClick={() => applyPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
        <span className="fc-preset-spacer" />
        <button type="button" className="fc-preset ghost" onClick={pinCompare} title="Freeze this scenario to compare">
          Pin to compare
        </button>
        <button type="button" className="fc-preset ghost" onClick={reset}>
          Reset
        </button>
      </div>

      <div className="fc-grid">
        {/* LEFT — controls */}
        <div className="v2-card fc-controls">
          <div className="v2-card-h"><h3>Inputs</h3><span className="v2-pill info">deterministic</span></div>
          <div className="fc-controls-body">
            <Slider label="Price change" suffix="%" min={-50} max={100} step={1}
              value={inputs.priceChangePct} onChange={(v) => setField({ priceChangePct: v })} />
            <Slider label="Monthly churn" suffix="%" min={0} max={25} step={0.5}
              value={inputs.monthlyChurnPct} onChange={(v) => setField({ monthlyChurnPct: v })} />
            <Slider label="New customers / mo" suffix="" min={0} max={500} step={5}
              value={inputs.monthlyNewCustomers} onChange={(v) => setField({ monthlyNewCustomers: v })} />
            <NumberField label="Infra cost / mo (£)" value={inputs.infraMonthlyCost} step={100}
              onChange={(v) => setField({ infraMonthlyCost: v })} />
            <NumberField label="Cash on hand (£)" value={inputs.cashOnHand} step={5000}
              onChange={(v) => setField({ cashOnHand: v })} />
            <Slider label="Horizon" suffix=" mo" min={3} max={36} step={1}
              value={inputs.months} onChange={(v) => setField({ months: v })} />

            <div className="fc-tiers">
              <div className="fc-tiers-h">Tier mix (customers)</div>
              {inputs.tierMix.map((t) => (
                <TierRow key={t.id} tier={t} onChange={(c) => setTierCustomers(t.id, c)} />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — outputs */}
        <div className="v2-stack">
          {/* Summary strip */}
          <div className="fc-tiles">
            <Tile k="End MRR" v={gbp0(s.endMrr)} meta={`${pct(s.mrrChangePct)} vs baseline`} tone="sky" />
            <Tile k="Runway" v={runwayLabel(s.runwayMonths)} meta={`at ${gbp0(forecast.months[0].burn)}/mo burn`} tone={runwayTone} />
            <Tile k="Break-even" v={s.breakEvenMonth ? `Mo ${s.breakEvenMonth}` : '—'}
              meta={s.breakEvenMonth ? 'revenue covers infra' : 'not within horizon'} tone={s.breakEvenMonth ? 'ok' : 'high'} />
            <Tile k="Total revenue" v={gbp0(s.totalRevenue)} meta={`over ${inputs.months} months`} tone="ok" />
          </div>

          {/* MRR chart */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>Projected MRR</h3>
              <span className="v2-sub" style={{ margin: 0 }}>
                {gbp0(forecast.baselineMrr)} → {gbp0(s.endMrr)} · ARPU {gbp0(forecast.effectiveArpu)}
              </span>
            </div>
            <MrrChart forecast={forecast} compare={compare?.forecast ?? null} />
          </div>

          {/* Compare strip */}
          {compare && (
            <div className="v2-card fc-compare">
              <div className="v2-card-h">
                <h3>Compare</h3>
                <button type="button" className="v2-link" onClick={() => setCompare(null)}>clear</button>
              </div>
              <div className="fc-compare-body">
                <CompareCol label={`${compare.label} (pinned)`} f={compare.forecast} />
                <CompareCol label="Current" f={forecast} accent />
              </div>
            </div>
          )}

          {/* Narrative */}
          <div className="v2-card">
            <div className="v2-card-h">
              <h3>What this means</h3>
              <button type="button" className="v2-link" onClick={askNarrative} disabled={narrBusy}>
                {narrBusy ? 'Thinking…' : 'Ask Hermes'}
              </button>
            </div>
            <div className="fc-narrative">
              {!brainEnabled && !narrative && !narrErr && (
                <p className="fc-muted">
                  Optional advisory read-out from the Hermes CFO copilot. The Brain is currently
                  disabled (<code>HERMES_BRAIN_ENABLED</code> off); the numbers above are complete on
                  their own. Enable the Brain to get an interpretation.
                </p>
              )}
              {brainEnabled && !narrative && !narrErr && !narrBusy && (
                <p className="fc-muted">
                  Click <b>Ask Hermes</b> for an advisory interpretation of this projection. It reads
                  the computed numbers only — it never changes them.
                </p>
              )}
              {narrative && <p className="fc-prose">{narrative}</p>}
              {narrErr && <p className="fc-err">{narrErr}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Presentational sub-components ─────────────────────────────────────────── */

function Slider({
  label, suffix, min, max, step, value, onChange,
}: {
  label: string; suffix: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="fc-ctl">
      <span className="fc-ctl-l">
        {label}
        <b>{value}{suffix}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function NumberField({
  label, value, step, onChange,
}: {
  label: string; value: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="fc-ctl">
      <span className="fc-ctl-l">{label}</span>
      <input className="fc-num" type="number" step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

function TierRow({ tier, onChange }: { tier: TierLine; onChange: (c: number) => void }) {
  return (
    <div className="fc-tier">
      <span className="fc-tier-nm">{tier.label}</span>
      <span className="fc-tier-pr">{tier.price ? gbp0(tier.price) : 'free'}</span>
      <input className="fc-num sm" type="number" min={0} step={1} value={tier.customers}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
    </div>
  );
}

function Tile({ k, v, meta, tone }: { k: string; v: string; meta: string; tone: string }) {
  return (
    <div className={`v2-tile t-${tone}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="meta">{meta}</div>
    </div>
  );
}

function MrrChart({ forecast, compare }: { forecast: Forecast; compare: Forecast | null }) {
  const series = forecast.months;
  const cmp = compare?.months ?? null;
  const peak = Math.max(
    1,
    ...series.map((m) => m.mrr),
    ...(cmp ? cmp.map((m) => m.mrr) : []),
  );
  return (
    <div className="fc-chart" role="img" aria-label="Projected MRR by month">
      {series.map((m, i) => {
        const h = Math.max(2, (m.mrr / peak) * 100);
        const ch = cmp && cmp[i] ? Math.max(2, (cmp[i].mrr / peak) * 100) : null;
        const tone = m.burn > 0 ? 'burn' : 'ok';
        return (
          <div className="fc-bar-slot" key={m.month} title={`Mo ${m.month}: ${gbp0(m.mrr)} MRR · ${m.customers} cust · burn ${gbp0(m.burn)}`}>
            <div className="fc-bars">
              {ch !== null && <span className="fc-bar cmp" style={{ height: `${ch}%` }} />}
              <span className={`fc-bar ${tone}`} style={{ height: `${h}%` }} />
            </div>
            {(i === 0 || (i + 1) % 3 === 0) && <span className="fc-bar-x">{m.month}</span>}
          </div>
        );
      })}
    </div>
  );
}

function CompareCol({ label, f, accent }: { label: string; f: Forecast; accent?: boolean }) {
  const s = f.summary;
  return (
    <div className={`fc-compare-col${accent ? ' accent' : ''}`}>
      <div className="fc-compare-nm">{label}</div>
      <Row k="End MRR" v={gbp0(s.endMrr)} />
      <Row k="Δ vs baseline" v={pct(s.mrrChangePct)} />
      <Row k="Runway" v={runwayLabel(s.runwayMonths)} />
      <Row k="Break-even" v={s.breakEvenMonth ? `Mo ${s.breakEvenMonth}` : '—'} />
      <Row k="Total revenue" v={gbp0(s.totalRevenue)} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="fc-compare-row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}
