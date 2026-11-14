import { memo } from 'react';
import {
  ENDING_NAMES, FORM_NAMES, HARMONY_NAMES, KEYPLAN_NAMES, MODE_NAMES, WORLD_NAMES, clock,
  grooveName, instrumentName, meterParts,
} from '../format';
import { useSel } from '../store';
import './rules.css';

/** The rules Drex set for this piece, laid out like the head of a score. */
export const RulesStrip = memo(function RulesStrip() {
  const rules = useSel((s) => s.rules);
  const sessionId = useSel((s) => s.session?.id ?? 'none');

  if (!rules) {
    return (
      <section className="rules rules--empty panel" aria-label="Rules">
        <span className="panel__title">Rules</span>
        <span className="rules__waiting score-text">Drex is choosing style, tempo, meter and key</span>
        <span className="rules__ghost" aria-hidden="true" />
      </section>
    );
  }

  const [top, bottom] = meterParts(rules.meter);

  return (
    // Keyed by session so a new prompt replays the reveal: different rules are the point.
    <section key={sessionId} className="rules panel" aria-label="Rules chosen by Drex">
      <div className="rules__lead">
        <span className="rules__label">
          Style
          {rules.groove && <span className="rules__groove" title={`Groove: ${grooveName(rules.groove)}`}> · {grooveName(rules.groove)}</span>}
        </span>
        <span className="rules__style score-text">{rules.styleName}</span>
      </div>

      <div className="rules__sig" aria-label={`Meter ${rules.meter}`}>
        <span className="rules__meter" aria-hidden="true">
          <b>{top}</b>
          <b>{bottom}</b>
        </span>
      </div>

      <Field label="Tempo">
        <span className="mono rules__big">{Math.round(rules.bpm)}</span>
        <span className="rules__unit">bpm</span>
      </Field>
      <Field label="Key">
        <span className="rules__big">{rules.keyName}</span>
        <span className="rules__unit score-text">{MODE_NAMES[rules.mode]}</span>
      </Field>
      <Field label="Harmony">{HARMONY_NAMES[rules.harmonicLanguage]}</Field>
      <Field label="Sound world">{WORLD_NAMES[rules.soundWorld]}</Field>
      <Field label="Form">{FORM_NAMES[rules.form]}</Field>
      <Field label="Key plan">{KEYPLAN_NAMES[rules.keyPlan]}</Field>
      <Field label="Ending">{ENDING_NAMES[rules.ending]}</Field>
      <Field label="Length">
        <span className="mono">{clock(rules.lengthSec)}</span>
      </Field>

      <div className="rules__field rules__palette">
        <span className="rules__label">Palette</span>
        <span className="rules__value">{rules.palette.map(instrumentName).join(', ')}</span>
      </div>
    </section>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rules__field">
      <span className="rules__label">{label}</span>
      <span className="rules__value">{children}</span>
    </div>
  );
}
