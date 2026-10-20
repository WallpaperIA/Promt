import { createHash } from 'node:crypto';
import { cookieSesion, hashSesion } from '../api/_cookie.js';

export const CAMPANA_PRUEBA = '1234567890';
// Los verificadores sólo usan bases y credenciales sintéticas.
process.env.PATREON_CAMPAIGN_ID = CAMPANA_PRUEBA;
export const tokenPrueba = etiqueta => createHash('sha256').update('fixture:' + etiqueta).digest('base64url');
export const hashTokenPrueba = etiqueta => hashSesion(tokenPrueba(etiqueta));
export function cabecerasSesion(etiqueta, extra = {}) {
  return { origin: 'https://promt-iota.vercel.app', host: 'promt-iota.vercel.app',
    ...(etiqueta ? { cookie: cookieSesion(tokenPrueba(etiqueta)).split(';')[0] } : {}), ...extra };
}
export function prepararSesiones(db) {
  db.tablas.users = db.tablas.users.map(u => ({ patreon_campaign_id: CAMPANA_PRUEBA, tier_checked_at: new Date().toISOString(), ...u }));
  db.tablas.sessions = db.tablas.sessions.map(s => ({ ...s, token: /^[a-f0-9]{64}$/.test(s.token) ? s.token : hashTokenPrueba(s.token) }));
  return db;
}
