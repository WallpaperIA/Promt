/**
 * Lógica de acceso. Es la AUTORITATIVA: el navegador sólo dibuja candados, y
 * para eso recibe GRATIS desde /api/catalog en vez de tener su propia copia.
 *
 * Hasta septiembre de 2026 había rotación semanal (free: 1 hot y 1 xxx por
 * semana; premium: 5 xxx) y un cupo de 5 prompts por semana contado por IP.
 * El dueño lo simplificó: free tiene cinco escenas fijas y nada más, premium
 * todo salvo xxx, full todo. Sin rotación no hay fórmula que mantener igual
 * en dos lados, y sin cupo desaparece el agujero de la IP rotativa del
 * celular, que daba más de 5.
 */

/**
 * Las cinco del plan gratis. Son las del post público de Patreon y las que
 * tienen foto de ejemplo: lo que se regala es lo mismo que se muestra.
 * Cambiar una es cambiar este array; la página se entera sola.
 */
export const GRATIS = Object.freeze([
  'beach-wet-dress',
  'predatory-lean',
  'recostada-macrame',
  'escenario-dorado',
  'tank-recostada',
]);

/**
 * @param {{id:string, tier:string}|null} cat
 * @param {'free'|'premium'|'full'} tier
 * @returns {{ok:boolean, reason?:string}}
 */
export function canAccess(cat, tier) {
  if (!cat) return { ok: false, reason: 'not_found' };

  if (tier === 'full') return { ok: true };

  if (tier === 'premium') {
    return cat.tier === 'xxx' ? { ok: false, reason: 'needs_full' } : { ok: true };
  }

  // free
  if (GRATIS.includes(cat.id)) return { ok: true };
  return { ok: false, reason: cat.tier === 'xxx' ? 'needs_full' : 'needs_premium' };
}
