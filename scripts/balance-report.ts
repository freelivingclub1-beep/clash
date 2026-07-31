/**
 * Roster balance and fairness report.
 *
 * Run with `npm run balance`. Prints three tables and then the flags:
 *
 *   1. the EPP audit ratio for every card, so a stat line that drifted out of
 *      budget is visible at a glance;
 *   2. tower pressure per aether, which is what catches a card that wins a
 *      lane on its own;
 *   3. trade value against the benchmark panel, in aether won or lost per
 *      fight — the same "elixir trade" a player reasons in.
 *
 * The bounded version of checks 2 and 3 runs in the test suite on every
 * commit; this is the full sweep with the numbers attached, for when a flag
 * needs interpreting rather than just detecting.
 */

import '@cards/data';
import { selectableCards } from '@cards/registry';
import { auditCard } from '@cards/balance';
import { roleOf } from '@cards/roles';
import { fairnessFlags, towerPressure, tradeValue, testableCards, MIN_TRADE_SAMPLES } from '@game/fairness';

const pad = (value: string | number, width: number) => String(value).padEnd(width);
const num = (value: number, width: number, digits = 2) =>
  value.toFixed(digits).padStart(width);

function auditTable(): void {
  console.log('\n=== EPP audit (stat line vs budget) ===');
  const rows = selectableCards()
    .filter((card) => card.category !== 'TowerTroop' && card.category !== 'Spell')
    .map((card) => ({ card, audit: auditCard(card) }))
    .sort((a, b) => b.audit.ratio - a.audit.ratio);

  for (const { card, audit } of rows) {
    const mark = audit.withinTolerance ? '   ' : ' !!';
    console.log(
      `${mark} ${pad(card.name, 20)} ${card.aetherCost}  ${pad(roleOf(card), 13)} ${num(audit.ratio, 5)}`,
    );
  }
  const outside = rows.filter((row) => !row.audit.withinTolerance);
  console.log(`${rows.length} cards, ${outside.length} outside tolerance`);
}

function towerTable(): void {
  console.log('\n=== Tower pressure (undefended princess tower, per aether) ===');
  const { rows, threshold } = towerPressure();
  rows.sort((a, b) => b.perAether - a.perAether);
  for (const row of rows.slice(0, 20)) {
    const mark = row.perAether > threshold ? ' !!' : '   ';
    console.log(
      `${mark} ${pad(row.name, 20)} ${row.aetherCost}  ${num(row.perAether, 6, 3)} per aether  ` +
        `tower ${num((1 - row.towerRemaining) * 100, 5, 0)}% down in ${row.seconds}s`,
    );
  }
  console.log(`  (top 20 of ${rows.length}; roster bar ${threshold.toFixed(3)})`);
}

function tradeTable(): void {
  console.log('\n=== Trade value (aether won per fight, benchmark panel) ===');
  const rows = testableCards()
    .filter((card) => card.damage > 0)
    .map((card) => tradeValue(card.id))
    .filter((row) => row.samples >= MIN_TRADE_SAMPLES)
    .sort((a, b) => b.netAether - a.netAether);

  const show = [...rows.slice(0, 10), null, ...rows.slice(-10)];
  for (const row of show) {
    if (!row) {
      console.log(`    ... ${rows.length - 20} cards between ...`);
      continue;
    }
    const sign = row.netAether > 0 ? '+' : '';
    console.log(`    ${pad(row.name, 20)} ${row.aetherCost}  ${sign}${row.netAether}`);
  }
}

auditTable();
towerTable();
tradeTable();

console.log('\n=== Fairness flags ===');
const flags = fairnessFlags();
if (flags.length === 0) {
  console.log('  none — the roster is clean.');
} else {
  for (const flag of flags) console.log(`  [${flag.kind}] ${flag.name}: ${flag.detail}`);
}
console.log('');
process.exitCode = flags.length > 0 ? 1 : 0;
