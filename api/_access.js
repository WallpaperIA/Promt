/**
 * Lógica de acceso. Es la copia AUTORITATIVA: el cliente tiene la suya sólo
 * para dibujar candados, pero acá se decide qué texto sale.
 *
 * La fórmula de rotación tiene que dar igual que la de index.html
 * (_week / _weekSet / canAccessCat). Si cambia una, cambiar la otra, o el
 * cliente mostrará como libre algo que el servidor va a negar.
 */

export const FREE_WEEKLY_LIMIT = 5;

/** Número de semana. El +2d alinea el corte con el lunes. */
export function currentWeek(now = Date.now()) {
  return Math.floor((now + 2 * 24 * 60 * 60 * 1000) / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Subconjunto determinista por semana.
 * @param {Array<{id:string}>} cats  ordenadas por sort_order
 */
export function weekSet(cats, count, offset, week) {
  const set = new Set();
  if (!cats.length) return set;
  for (let i = 0; i < count; i++) {
    const cat = cats[(week * 17 + i * 31 + offset) % cats.length];
    if (cat) set.add(cat.id);
  }
  return set;
}

/**
 * @param {Array<{id:string,tier:string,ready:boolean}>} categories ordenadas por sort_order
 */
export function buildRotation(categories, week = currentWeek()) {
  const hot = categories.filter((c) => c.tier === 'hot' && c.ready);
  const xxx = categories.filter((c) => c.tier === 'xxx' && c.ready);
  return {
    week,
    freeHotIds: weekSet(hot, 1, 0, week),
    freeXxxIds: weekSet(xxx, 1, 7, week),
    premXxxIds: weekSet(xxx, 5, 3, week),
  };
}

/**
 * @returns {{ok:boolean, reason?:string, countsAgainstQuota:boolean}}
 */
export function canAccess(cat, tier, rotation) {
  if (!cat) return { ok: false, reason: 'not_found', countsAgainstQuota: false };

  if (tier === 'full') return { ok: true, countsAgainstQuota: false };

  if (cat.tier === 'casual' || cat.tier === 'editorial') {
    // Contenido de entrada: abierto, pero para el tier free consume cupo.
    return { ok: true, countsAgainstQuota: tier === 'free' };
  }

  if (tier === 'premium') {
    if (cat.tier === 'hot') return { ok: true, countsAgainstQuota: false };
    if (cat.tier === 'xxx') {
      return rotation.premXxxIds.has(cat.id)
        ? { ok: true, countsAgainstQuota: false }
        : { ok: false, reason: 'needs_full', countsAgainstQuota: false };
    }
    return { ok: false, reason: 'needs_full', countsAgainstQuota: false };
  }

  // free
  if (cat.tier === 'hot') {
    return rotation.freeHotIds.has(cat.id)
      ? { ok: true, countsAgainstQuota: true }
      : { ok: false, reason: 'needs_premium', countsAgainstQuota: false };
  }
  if (cat.tier === 'xxx') {
    return rotation.freeXxxIds.has(cat.id)
      ? { ok: true, countsAgainstQuota: true }
      : { ok: false, reason: 'needs_full', countsAgainstQuota: false };
  }
  return { ok: false, reason: 'needs_premium', countsAgainstQuota: false };
}
