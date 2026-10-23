import { createHash, randomBytes } from 'node:crypto';
import { esOrigenCuenta } from './_config.js';

export const COOKIE_SESION = '__Host-wp_session';
export const DURACION_SESION_SEG = 30 * 24 * 60 * 60;

export function leerCookie(req, nombre) {
  const partes = String(req.headers?.cookie || '').split(';');
  const valores = partes.map(p => p.trim()).filter(p => p.startsWith(nombre + '='));
  // Dos cookies con el mismo nombre son ambiguas: no elegir la que convenga.
  return valores.length === 1 ? valores[0].slice(nombre.length + 1) : null;
}

export function origenSesionValido(req) {
  const origen = req.headers?.origin;
  const host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (origen && (!esOrigenCuenta(origen) || (host && origen !== 'https://' + host))) return false;
  // Las escrituras con cookie necesitan Origin aunque CORS no intervenga.
  return ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || Boolean(origen);
}

export function tokenDeSesion(req) {
  if (!origenSesionValido(req)) return null;
  const token = leerCookie(req, COOKIE_SESION);
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function hashSesion(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function nuevaSesion() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSesion(token), expiresAt: new Date(Date.now() + DURACION_SESION_SEG * 1000).toISOString() };
}

export function cookieSesion(token, maxAge = DURACION_SESION_SEG) {
  return `${COOKIE_SESION}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Cookies cortas del OAuth (state y origen de vuelta). Max-Age 0 la borra. */
export const COOKIE_VUELTA = 'oauth_vuelta';
export function cookieTemporal(nombre, valor, maxAge) {
  return `${nombre}=${valor}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function borrarCookieSesion(res) {
  res.setHeader('Set-Cookie', cookieSesion('', 0));
}

export function exigirOrigenSesion(req, res) {
  if (origenSesionValido(req)) return true;
  res.status(403).json({ error: 'invalid_origin' });
  return false;
}
