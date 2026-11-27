/**
 * Tope de pedidos por dispositivo, en la memoria de cada instancia.
 *
 * Las respuestas caras ya se guardan en memoria (catálogo, textos y lotes de
 * fotos), así que la base no ve cada pedido. Esto es lo que falta para que un
 * solo dispositivo en bucle tampoco gaste las funciones, la transferencia de
 * Vercel ni las consultas que sí van a la base en cada pedido (la sesión y
 * los permisos). Los topes son amplios: el uso normal de la página queda
 * muy por debajo.
 *
 * Es por instancia, no global: si Vercel reparte los pedidos entre varias,
 * cada una lleva su cuenta. Alcanza para cortar un bucle; un ataque
 * distribuido es trabajo del firewall de Vercel.
 */

const VENTANA_MS = 60 * 1000;
/** Sobre esta cantidad se limpian las ventanas vencidas; si siguen siendo
 *  demasiadas (muchas IP distintas), se empieza de cero antes que crecer. */
const MAX_CLAVES = 20000;
const cuentas = new Map();

/**
 * Los primeros 64 bits de una IPv6, en una sola forma: "2001:db8::1" y
 * "2001:db8:0:0:5::9" son el mismo bloque aunque se escriban distinto.
 * Una IPv4 escrita como IPv6 (::ffff:a.b.c.d) cuenta como esa IPv4.
 */
function bloqueIPv6(ip) {
  const v6 = ip.split('%')[0].toLowerCase();
  const v4 = v6.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  const [izquierda, derecha] = v6.split('::');
  const a = izquierda ? izquierda.split(':') : [];
  const b = derecha ? derecha.split(':') : [];
  const grupos = derecha === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return grupos.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

/**
 * La IP del cliente según Vercel, que pone x-real-ip y x-forwarded-for y no
 * deja pasar los que manda el pedido. En IPv6 cuenta el bloque /64: es lo
 * que suele tener un solo hogar o celular, que puede ir cambiando la parte
 * final. Sin ninguna (pruebas, servidor local) no se limita.
 */
export function ipDe(req) {
  const h = req.headers || {};
  const ip = String(h['x-real-ip'] || h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || '').split(',')[0].trim();
  if (!ip) return '';
  return ip.includes(':') ? bloqueIPv6(ip) : ip;
}

/**
 * true si este dispositivo ya hizo `maximo` pedidos de `nombre` en el último
 * minuto; en ese caso ya respondió 429 con Retry-After.
 */
export function limitar(req, res, nombre, maximo, ahora = Date.now()) {
  const ip = ipDe(req);
  if (!ip) return false;
  if (cuentas.size > MAX_CLAVES) {
    for (const [clave, c] of cuentas) if (ahora - c.desde >= VENTANA_MS) cuentas.delete(clave);
    if (cuentas.size > MAX_CLAVES) cuentas.clear();
  }
  const clave = nombre + '|' + ip;
  let c = cuentas.get(clave);
  if (!c || ahora - c.desde >= VENTANA_MS) {
    c = { desde: ahora, n: 0 };
    cuentas.set(clave, c);
  }
  c.n++;
  if (c.n <= maximo) return false;
  const segundos = Math.max(1, Math.ceil((c.desde + VENTANA_MS - ahora) / 1000));
  res.setHeader('Retry-After', String(segundos));
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(429).json({ error: 'demasiados_pedidos', reintentar: segundos });
  return true;
}
