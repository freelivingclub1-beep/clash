/**
 * Card Maker Studio (spec §4).
 *
 * Every control here is bound to a field on the same Zod schema the simulation
 * reads, and validation runs through the same `validateCard` the built-in
 * roster is checked with. There is no separate "editor model" to keep in sync
 * — a card that validates here is by construction a card the engine can spawn.
 *
 * Sections reveal conditionally (splash radius only for splash damage types,
 * Section F only when the card has an evolution, Section G only for heroes) so
 * the form stays short on a phone rather than presenting sixty fields at once.
 */

import { useMemo, useState } from 'react';
import {
  type CardDraft,
  ABILITY_HOOKS,
  ABILITY_TARGET_FILTERS,
  CARD_CATEGORIES,
  DAMAGE_TYPES,
  DEATH_EFFECTS,
  RARITIES,
  SPEED_CLASSES,
  STATUS_EFFECTS,
  TARGET_PRIORITIES,
  emptyCardDraft,
  makeCardId,
  validateCard,
} from '@cards/schema';
import { registerCardFromJson } from '@cards/registry';
import { derivedStats, MAX_LEVEL, BASELINE_LEVEL } from '@cards/scaling';
import { registeredEvolutionScripts } from '@sim/scripts/evolutions';

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  invalid?: string;
  children: React.ReactNode;
}

function Field({ label, invalid, children }: FieldProps) {
  return (
    <div className={`field${invalid ? ' invalid' : ''}`}>
      <label>{label}</label>
      {children}
      {invalid && <span className="error">{invalid}</span>}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  invalid,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: string;
  multiline?: boolean;
}) {
  return (
    <Field label={label} invalid={invalid}>
      {multiline ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
  invalid,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  invalid?: string;
}) {
  return (
    <Field label={label} invalid={invalid}>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </Field>
  );
}

function SliderInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  invalid,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  invalid?: string;
}) {
  return (
    <div className={`field${invalid ? ' invalid' : ''}`}>
      <div className="field inline" style={{ padding: 0 }}>
        <label>{label}</label>
        <span className="value">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {invalid && <span className="error">{invalid}</span>}
    </div>
  );
}

function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
  invalid,
}: {
  label: string;
  value: T;
  options: readonly T[] | readonly number[];
  onChange: (value: string) => void;
  invalid?: string;
}) {
  return (
    <Field label={label} invalid={invalid}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="form-section">
      <div className="title">{title}</div>
      {children}
    </section>
  );
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

// ---------------------------------------------------------------------------
// The studio
// ---------------------------------------------------------------------------

export function CardMaker({ onBack }: { onBack: () => void }) {
  const [draft, setDraft] = useState<CardDraft>(() => emptyCardDraft());
  const [status, setStatus] = useState<string>('');

  const validation = useMemo(() => validateCard(draft), [draft]);
  const issueFor = (path: string) => validation.issues.find((i) => i.path === path)?.message;

  /**
   * The internal id is derived, never typed. Any edit to name or category
   * regenerates it, which is exactly the invariant the schema enforces.
   */
  const update = <K extends keyof CardDraft>(key: K, value: CardDraft[K]) => {
    setStatus('');
    setDraft((previous) => {
      const next = { ...previous, [key]: value };
      if (key === 'name' || key === 'category') {
        next.id = makeCardId(next.category, next.name);
      }
      // A hero must be Champion rarity; keep the form self-consistent rather
      // than letting the user hit a validation error they cannot interpret.
      if (key === 'isHero' && value === true) next.rarity = 'Champion';
      return next;
    });
  };

  const stats = useMemo(
    () => (validation.ok && validation.card ? derivedStats(validation.card) : null),
    [validation],
  );

  const exportJson = () => {
    const json = JSON.stringify(draft, null, 2);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
    setStatus('Copied JSON to clipboard.');
  };

  const importJson = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text) {
        setStatus('Clipboard is empty.');
        return;
      }
      const parsed = JSON.parse(text);
      const result = validateCard(parsed);
      if (!result.ok) {
        setStatus(`Import rejected: ${result.issues[0]?.message ?? 'invalid card'}`);
        return;
      }
      setDraft(parsed as CardDraft);
      setStatus('Imported card from clipboard.');
    } catch {
      setStatus('Could not read valid card JSON from the clipboard.');
    }
  };

  const addToRoster = () => {
    const result = registerCardFromJson(draft, { runtime: true });
    setStatus(
      result.ok
        ? `${draft.name} added to the roster — it is now selectable in the deck builder.`
        : `Cannot add: ${result.issues[0]?.message ?? 'invalid card'}`,
    );
  };

  const isSplash = draft.damageType === 'AreaSplash' || draft.damageType === 'ConeSplash';
  const isSpell = draft.category === 'Spell';

  return (
    <div className="stage">
      <div className="nav-bar">
        <button onClick={onBack}>← Back</button>
        <button className="active">Card Maker</button>
      </div>

      <div className="screen">
        {/* --- A ------------------------------------------------------------ */}
        <Section title="A · Identification & Metadata">
          <TextInput
            label="Card Name"
            value={draft.name}
            onChange={(v) => update('name', v)}
            invalid={issueFor('name')}
          />
          <Field label="Internal ID (generated)">
            <input type="text" value={draft.id} readOnly />
          </Field>
          <div className="grid-2">
            <SelectInput
              label="Rarity"
              value={draft.rarity}
              options={RARITIES}
              onChange={(v) => update('rarity', v as CardDraft['rarity'])}
              invalid={issueFor('rarity')}
            />
            <SelectInput
              label="Category"
              value={draft.category}
              options={CARD_CATEGORIES}
              onChange={(v) => update('category', v as CardDraft['category'])}
            />
          </div>
          <div className="grid-2">
            <SelectInput
              label="Aether Cost"
              value={String(draft.aetherCost)}
              options={range(1, 10)}
              onChange={(v) => update('aetherCost', Number(v))}
            />
            <SelectInput
              label="Unlock Arena"
              value={String(draft.unlockArena)}
              options={range(1, 24)}
              onChange={(v) => update('unlockArena', Number(v))}
            />
          </div>
          <TextInput
            label="Description"
            value={draft.description}
            onChange={(v) => update('description', v)}
            multiline
          />
        </Section>

        {/* --- B ------------------------------------------------------------ */}
        <Section title="B · Assets & Render">
          <TextInput
            label="Mesh / Sprite Sheet Key"
            value={draft.spriteKey}
            onChange={(v) => update('spriteKey', v)}
          />
          <div className="grid-2">
            <TextInput
              label="Spawn Sound Key"
              value={draft.spawnSoundKey}
              onChange={(v) => update('spawnSoundKey', v)}
            />
            <TextInput
              label="Attack Sound Key"
              value={draft.attackSoundKey}
              onChange={(v) => update('attackSoundKey', v)}
            />
          </div>
          <div className="grid-2">
            <TextInput
              label="Deployment VFX ID"
              value={draft.deployVfxId}
              onChange={(v) => update('deployVfxId', v)}
            />
            <Field label="Placeholder Tint" invalid={issueFor('tint')}>
              <input
                type="color"
                value={draft.tint}
                onChange={(e) => update('tint', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        {/* --- C ------------------------------------------------------------ */}
        <Section title="C · Entity Attributes & Health">
          <NumberInput
            label={`Base Health (at level ${BASELINE_LEVEL})`}
            value={draft.baseHealth}
            onChange={(v) => update('baseHealth', v)}
            invalid={issueFor('baseHealth')}
          />
          <SliderInput
            label="Scaling Multiplier"
            value={draft.scalingMultiplier}
            min={1}
            max={1.5}
            step={0.01}
            onChange={(v) => update('scalingMultiplier', v)}
            format={(v) => `${v.toFixed(2)}x per level`}
          />
          <div className="grid-2">
            <NumberInput
              label="Shield Health"
              value={draft.shieldHealth}
              onChange={(v) => update('shieldHealth', v)}
            />
            <SelectInput
              label="Spawn Quantity"
              value={String(draft.spawnCount)}
              options={range(1, 20)}
              onChange={(v) => update('spawnCount', Number(v))}
            />
          </div>
          <SliderInput
            label="Mass Weight (knockback resistance)"
            value={draft.massWeight}
            min={1}
            max={100}
            step={1}
            onChange={(v) => update('massWeight', v)}
          />
          <SelectInput
            label="Movement Speed Class"
            value={draft.speedClass}
            options={SPEED_CLASSES}
            onChange={(v) => update('speedClass', v as CardDraft['speedClass'])}
          />
          <SliderInput
            label="Body Radius"
            value={draft.bodyRadius}
            min={0.1}
            max={3}
            step={0.05}
            onChange={(v) => update('bodyRadius', v)}
            format={(v) => `${v.toFixed(2)} tiles`}
          />
          <div className="row">
            <Toggle label="Flying" value={draft.isFlying} onChange={(v) => update('isFlying', v)} />
          </div>
          {draft.category === 'Building' && (
            <SliderInput
              label="Lifetime (decay)"
              value={draft.lifetimeSeconds}
              min={0}
              max={120}
              step={1}
              onChange={(v) => update('lifetimeSeconds', v)}
              format={(v) => `${v}s`}
              invalid={issueFor('lifetimeSeconds')}
            />
          )}
        </Section>

        {/* --- D ------------------------------------------------------------ */}
        <Section title="D · Offensive & Combat">
          <SelectInput
            label="Target Priority"
            value={draft.targetPriority}
            options={TARGET_PRIORITIES}
            onChange={(v) => update('targetPriority', v as CardDraft['targetPriority'])}
          />
          <SliderInput
            label="Attack Range"
            value={draft.attackRange}
            min={0}
            max={11.5}
            step={0.1}
            onChange={(v) => update('attackRange', v)}
            format={(v) =>
              v <= 0.5
                ? `${v.toFixed(1)} · melee short`
                : v <= 1.2
                  ? `${v.toFixed(1)} · melee medium`
                  : v <= 1.6
                    ? `${v.toFixed(1)} · melee long`
                    : `${v.toFixed(1)} tiles · ranged`
            }
          />
          <SliderInput
            label="Sight Range"
            value={draft.sightRange}
            min={0}
            max={14}
            step={0.1}
            onChange={(v) => update('sightRange', v)}
            format={(v) => `${v.toFixed(1)} tiles`}
          />
          <div className="grid-2">
            <NumberInput
              label="Hit Speed (s)"
              value={draft.hitSpeed}
              step={0.1}
              onChange={(v) => update('hitSpeed', v)}
              invalid={issueFor('hitSpeed')}
            />
            <NumberInput
              label="Damage Per Hit"
              value={draft.damage}
              onChange={(v) => update('damage', v)}
            />
          </div>
          <SelectInput
            label="Damage Type"
            value={draft.damageType}
            options={DAMAGE_TYPES}
            onChange={(v) => update('damageType', v as CardDraft['damageType'])}
          />
          {/* Splash radius is meaningless for single-target damage, and the
              schema rejects it outright — so it is only offered when relevant. */}
          {(isSplash || isSpell) && (
            <SliderInput
              label="Splash Radius"
              value={draft.splashRadius}
              min={0}
              max={isSpell ? 6 : 3}
              step={0.1}
              onChange={(v) => update('splashRadius', v)}
              format={(v) => `${v.toFixed(1)} tiles`}
              invalid={issueFor('splashRadius')}
            />
          )}
          <NumberInput
            label="First Attack Delay (s)"
            value={draft.firstAttackDelay}
            step={0.1}
            onChange={(v) => update('firstAttackDelay', v)}
          />
          <Toggle
            label="Fires a travelling projectile"
            value={draft.usesProjectile}
            onChange={(v) => update('usesProjectile', v)}
          />
        </Section>

        {/* --- E ------------------------------------------------------------ */}
        <Section title="E · Special Abilities & Effects">
          <SelectInput
            label="On-Hit Status Effect"
            value={draft.onHitStatus}
            options={STATUS_EFFECTS}
            onChange={(v) => update('onHitStatus', v as CardDraft['onHitStatus'])}
          />
          {draft.onHitStatus !== 'None' && (
            <div className="grid-2">
              <NumberInput
                label="Status Duration (s)"
                value={draft.statusDuration}
                step={0.1}
                onChange={(v) => update('statusDuration', v)}
                invalid={issueFor('statusDuration')}
              />
              <NumberInput
                label="Status Magnitude"
                value={draft.statusMagnitude}
                step={0.1}
                onChange={(v) => update('statusMagnitude', v)}
              />
            </div>
          )}
          <SelectInput
            label="Death Effect Trigger"
            value={draft.deathEffect}
            options={DEATH_EFFECTS}
            onChange={(v) => update('deathEffect', v as CardDraft['deathEffect'])}
          />
          {draft.deathEffect !== 'None' && (
            <>
              <TextInput
                label="Death Effect Parameter (unit id or radius)"
                value={draft.deathEffectParam}
                onChange={(v) => update('deathEffectParam', v)}
              />
              <div className="grid-2">
                <NumberInput
                  label="Death Effect Damage"
                  value={draft.deathEffectDamage}
                  onChange={(v) => update('deathEffectDamage', v)}
                  invalid={issueFor('deathEffectDamage')}
                />
                <NumberInput
                  label="Death Spawn Count"
                  value={draft.deathEffectCount}
                  onChange={(v) => update('deathEffectCount', v)}
                  invalid={issueFor('deathEffectCount')}
                />
              </div>
            </>
          )}
        </Section>

        {/* --- F ------------------------------------------------------------ */}
        <Section title="F · Evolution Engine">
          <Toggle
            label="Has Evolution Variation"
            value={draft.hasEvolution}
            onChange={(v) => update('hasEvolution', v)}
          />
          {draft.hasEvolution && (
            <>
              <SelectInput
                label="Evolution Cycle Requirement"
                value={String(draft.evoCycleRequirement)}
                options={[1, 2, 3]}
                onChange={(v) => update('evoCycleRequirement', Number(v))}
              />
              <SliderInput
                label="Evolution Health Multiplier"
                value={draft.evoHealthMultiplier}
                min={1}
                max={3}
                step={0.05}
                onChange={(v) => update('evoHealthMultiplier', v)}
                format={(v) => `${v.toFixed(2)}x`}
              />
              <SliderInput
                label="Evolution Damage Multiplier"
                value={draft.evoDamageMultiplier}
                min={1}
                max={3}
                step={0.05}
                onChange={(v) => update('evoDamageMultiplier', v)}
                format={(v) => `${v.toFixed(2)}x`}
              />
              <Field label="Unique Behaviour Script ID">
                <select
                  value={draft.evoBehaviorScriptId}
                  onChange={(e) => update('evoBehaviorScriptId', e.target.value)}
                >
                  <option value="">(stats only — no script)</option>
                  {registeredEvolutionScripts().map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </Section>

        {/* --- G ------------------------------------------------------------ */}
        <Section title="G · Hero & Champion Ability">
          <Toggle
            label="Is Hero / Champion Card"
            value={draft.isHero}
            onChange={(v) => update('isHero', v)}
          />
          {draft.isHero && (
            <>
              <div className="grid-2">
                <SelectInput
                  label="Ability Aether Cost"
                  value={String(draft.abilityAetherCost)}
                  options={range(1, 4)}
                  onChange={(v) => update('abilityAetherCost', Number(v))}
                />
                <NumberInput
                  label="Ability Cooldown (s)"
                  value={draft.abilityCooldown}
                  step={0.5}
                  onChange={(v) => update('abilityCooldown', v)}
                />
              </div>
              <SelectInput
                label="Ability Action Hook"
                value={draft.abilityActionHook}
                options={ABILITY_HOOKS}
                onChange={(v) => update('abilityActionHook', v as CardDraft['abilityActionHook'])}
              />
              <SelectInput
                label="Ability Target Filter"
                value={draft.abilityTargetFilter}
                options={ABILITY_TARGET_FILTERS}
                onChange={(v) =>
                  update('abilityTargetFilter', v as CardDraft['abilityTargetFilter'])
                }
              />
              <div className="grid-2">
                <NumberInput
                  label="Ability Damage"
                  value={draft.abilityDamage}
                  onChange={(v) => update('abilityDamage', v)}
                />
                <NumberInput
                  label="Ability Radius (tiles)"
                  value={draft.abilityRadius}
                  step={0.5}
                  onChange={(v) => update('abilityRadius', v)}
                />
              </div>
              <NumberInput
                label="Ability Duration (s)"
                value={draft.abilityDurationSeconds}
                step={0.1}
                onChange={(v) => update('abilityDurationSeconds', v)}
              />
            </>
          )}
        </Section>

        {/* --- live preview -------------------------------------------------- */}
        <Section title="Live Preview">
          {validation.ok && stats ? (
            <>
              <div className="stat-line">
                <span className="label">Damage per second</span>
                <span>{stats.dps}</span>
              </div>
              <div className="stat-line">
                <span className="label">Swarm health ({draft.spawnCount}x)</span>
                <span>{stats.swarmHealth}</span>
              </div>
              <div className="stat-line">
                <span className="label">Speed</span>
                <span>{stats.tilesPerSecond} tiles/s</span>
              </div>
              <div className="stat-line">
                <span className="label">Aether per 1000 health</span>
                <span>{stats.aetherPerThousandHealth}</span>
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                Health by level (1–{MAX_LEVEL})
              </div>
              <div className="level-table">
                {stats.healthPerLevel.map((hp, index) => (
                  <div
                    key={index}
                    className={`cell${index + 1 === BASELINE_LEVEL ? ' baseline' : ''}`}
                  >
                    <div>{index + 1}</div>
                    <div>{hp}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="error">
              {validation.issues.map((issue) => (
                <div key={`${issue.path}-${issue.message}`}>
                  {issue.path}: {issue.message}
                </div>
              ))}
            </div>
          )}
        </Section>

        <div className="row">
          <button className="button" disabled={!validation.ok} onClick={addToRoster}>
            Add to Roster
          </button>
          <button className="button secondary" onClick={exportJson}>
            Export JSON
          </button>
          <button className="button secondary" onClick={importJson}>
            Import JSON
          </button>
          <button className="button secondary" onClick={() => setDraft(emptyCardDraft())}>
            Reset
          </button>
        </div>
        {status && <div className="muted">{status}</div>}
      </div>
    </div>
  );
}
