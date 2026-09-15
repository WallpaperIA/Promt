#!/usr/bin/env node
/**
 * Comprueba la lógica de tiers y la firma del webhook sin tocar Patreon
 * ni Supabase.
 *
 * Uso:  node scripts/verify-patreon.mjs
 */
import crypto from 'node:crypto';
import { tierDesdeCentavos, tierDesdeMembresias } from '../api/_patreon.js';

let fallos = 0;
const ok = (cond, msg) => {
  if (!cond) { fallos++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
};

console.log('\n════ MONTOS → TIER ════');
// El bug anterior: sólo 700 y 1000 exactos daban algo; el resto quedaba free.
const montos = [
  [0, 'free'], [100, 'free'], [699, 'free'],
  [700, 'premium'], [800, 'premium'], [999, 'premium'],
  [1000, 'full'], [1200, 'full'], [1500, 'full'], [5000, 'full'],
];
for (const [c, esperado] of montos) {
  const real = tierDesdeCentavos(c);
  ok(real === esperado, `$${(c / 100).toFixed(2).padStart(6)} → ${real.padEnd(7)} (esperado ${esperado})`);
}

console.log('\n════ CASOS QUE ANTES FALLABAN ════');
ok(tierDesdeCentavos(2000) === 'full', 'quien paga $20 recibe full, antes quedaba free');
ok(tierDesdeCentavos(800) === 'premium', 'quien paga $8 recibe premium, antes quedaba free');

console.log('\n════ MEMBRESÍAS ════');
const m = (cents, status = 'active_patron') => ({
  type: 'member',
  attributes: { currently_entitled_amount_cents: cents, patron_status: status },
});
ok(tierDesdeMembresias([m(1000)]) === 'full', 'una membresía activa de $10 → full');
ok(tierDesdeMembresias([m(1000, 'former_patron')]) === 'free', 'ex-patrocinador → free aunque el monto figure');
ok(tierDesdeMembresias([m(700, 'declined_patron')]) === 'free', 'pago rechazado → free');
ok(tierDesdeMembresias([m(700), m(1000)]) === 'full', 'con varias activas se toma la más alta');
ok(tierDesdeMembresias([m(1000), m(700)]) === 'full', 'el orden no cambia el resultado');
ok(tierDesdeMembresias([]) === 'free', 'sin membresías → free');
ok(tierDesdeMembresias(undefined) === 'free', 'sin el campo included → free');
ok(tierDesdeMembresias([{ type: 'user', attributes: {} }]) === 'free', 'ignora lo que no sea member');

console.log('\n════ FIRMA DEL WEBHOOK ════');
const SECRETO = 'secreto-de-prueba';
const firmar = (cuerpo) => crypto.createHmac('md5', SECRETO).update(cuerpo).digest('hex');

function firmaValida(crudo, recibida, secreto) {
  if (!secreto || !recibida) return false;
  const esperada = crypto.createHmac('md5', secreto).update(crudo).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(recibida), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const cuerpo = Buffer.from(JSON.stringify({ data: { attributes: { currently_entitled_amount_cents: 1000 } } }));
ok(firmaValida(cuerpo, firmar(cuerpo), SECRETO) === true, 'acepta una firma correcta');
ok(firmaValida(cuerpo, firmar(cuerpo), 'otro-secreto') === false, 'rechaza con el secreto equivocado');
ok(firmaValida(cuerpo, 'a'.repeat(32), SECRETO) === false, 'rechaza una firma inventada del mismo largo');
ok(firmaValida(cuerpo, 'corta', SECRETO) === false, 'rechaza una firma de largo distinto');
ok(firmaValida(cuerpo, null, SECRETO) === false, 'rechaza si no viene firma');
ok(firmaValida(cuerpo, firmar(cuerpo), null) === false, 'rechaza si no hay secreto configurado');
const alterado = Buffer.from(cuerpo.toString().replace('1000', '9999'));
ok(firmaValida(alterado, firmar(cuerpo), SECRETO) === false, 'rechaza si el cuerpo fue alterado');

console.log(
  fallos
    ? `\n✗ ${fallos} comprobaciones fallaron\n`
    : '\n✓ todas las comprobaciones pasaron\n'
);
process.exit(fallos ? 1 : 0);
