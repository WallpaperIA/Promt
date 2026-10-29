import { CLAVES_AJUSTES, validarAjustes, cambiosAjustes, combinarAjustes } from './ajustes-datos.js';

const OWNER = 'wp_settings_owner_v1';
const LEGADO = 'wp_settings_legacy_backup_v1';
const RECLAMADO = 'wp_settings_legacy_owner_v1';
const PREFIJO = 'wp_settings_account_v1:';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function crearSincronizador({ storage, pedir, estado = () => {}, cambiaron = () => {}, puedeAplicar = () => true }) {
  let cuenta = null, base = {}, revision = 0, activa = false, pendiente = null;
  const leer = k => { try { return storage.getItem(k); } catch { return null; } };
  const escribir = (k, v) => { try { v === null ? storage.removeItem(k) : storage.setItem(k, v); return true; } catch { estado('sin-espacio'); return false; } };
  const parsear = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
  function local() {
    const datos = {};
    for (const k of CLAVES_AJUSTES) {
      const v = leer(k);
      if (v !== null && validarAjustes({ [k]: v })) datos[k] = v;
    }
    return datos;
  }
  function aplicar(datos) {
    for (const k of CLAVES_AJUSTES) escribir(k, datos[k] ?? null);
  }
  const cache = id => parsear(leer(PREFIJO + id));
  function recordar(id, datos = local()) {
    const anterior = cache(id);
    escribir(PREFIJO + id, JSON.stringify({ ...anterior, local: datos,
      ...(id === cuenta ? { base, revision } : {}) }));
  }
  function respuestaValida(d) {
    return d && UUID.test(d.accountId) && Number.isSafeInteger(d.revision) && d.revision >= 0 && validarAjustes(d.settings);
  }
  function fusionar(remoto, origen, anterior) {
    const r = combinarAjustes(anterior, origen, remoto);
    if (r.conflictos.length) {
      const c = cache(cuenta);
      escribir(PREFIJO + cuenta, JSON.stringify({ ...c, respaldoConflicto: origen, conflictos: r.conflictos }));
      estado('combinados');
    }
    return r.datos;
  }
  async function cargar() {
    if (activa && !puedeAplicar()) return true;
    const antes = local(), dueñoAnterior = leer(OWNER);
    if (dueñoAnterior) recordar(dueñoAnterior, antes);
    let r, d;
    try { r = await pedir('GET'); if (r.ok) d = await r.json(); }
    catch { estado('pendiente'); return false; }
    if (r.status === 401 || r.status === 403) {
      activa = false; cuenta = null;
      // Un visitante recupera sólo su perfil de visitante, nunca el de la
      // cuenta que acaba de salir de este navegador.
      if (dueñoAnterior && dueñoAnterior !== 'guest') {
        aplicar(cache('guest').local || {});
        escribir(OWNER, 'guest');
        cambiaron({ recargar: true, autenticada: false });
      } else { estado('local'); cambiaron({ recargar: false, autenticada: false }); }
      return true;
    }
    if (!r.ok || !respuestaValida(d)) { estado('pendiente'); return false; }
    cuenta = d.accountId;
    const previa = cache(cuenta);
    if (previa.conflictos?.length) estado('combinados');
    let origen = dueñoAnterior === cuenta ? antes : (previa.local || {});
    let anterior = previa.base || {};
    if (!dueñoAnterior && !leer(RECLAMADO)) {
      // La copia anterior queda intacta en un respaldo local. Sólo la primera
      // cuenta puede reclamar datos heredados que no tenían dueño registrado.
      escribir(LEGADO, JSON.stringify(antes));
      escribir(RECLAMADO, cuenta);
      origen = antes; anterior = {};
    }
    if (!validarAjustes(origen)) { estado('demasiado-grande'); return false; }
    if (!validarAjustes(anterior)) anterior = {};
    const combinado = fusionar(d.settings, origen, anterior);
    base = d.settings; revision = d.revision; activa = true;
    aplicar(combinado);
    escribir(OWNER, cuenta); recordar(cuenta);
    await guardar();
    cambiaron({ recargar: JSON.stringify(antes) !== JSON.stringify(local()), autenticada: true });
    return true;
  }
  function guardar({ keepalive = false } = {}) {
    if (!activa) return Promise.resolve(false);
    if (pendiente) return pendiente;
    pendiente = (async () => {
      for (let intento = 0; intento < 4; intento++) {
        if (leer(OWNER) !== cuenta) { activa = false; estado('otra-cuenta'); return false; }
        const enviado = local(), cambios = cambiosAjustes(base, enviado);
        recordar(cuenta, enviado);
        if (!Object.keys(cambios).length) { estado('guardado'); return true; }
        estado('guardando');
        let r, d;
        try {
          r = await pedir('PATCH', { accountId: cuenta, revision, changes: cambios }, keepalive);
          d = await r.json();
        } catch { estado('pendiente'); return false; }
        if (leer(OWNER) !== cuenta) { activa = false; estado('otra-cuenta'); return false; }
        if (r.status === 401 || r.status === 403 || d.error === 'account_changed' || (d.accountId && d.accountId !== cuenta)) {
          activa = false; estado('otra-cuenta'); return false;
        }
        if (r.status === 409 && d.error === 'revision_conflict' && respuestaValida(d)) {
          if (!puedeAplicar()) { estado('cambios-remotos'); return false; }
          // Se incluyen también cambios hechos mientras viajaba el pedido.
          const unido = fusionar(d.settings, local(), base);
          base = d.settings; revision = d.revision;
          aplicar(unido); recordar(cuenta);
          cambiaron({ recargar: JSON.stringify(enviado) !== JSON.stringify(unido), autenticada: true });
          continue;
        }
        if (!r.ok || !respuestaValida(d)) { estado(r.status === 413 ? 'demasiado-grande' : 'pendiente'); return false; }
        base = d.settings; revision = d.revision; recordar(cuenta);
        // Una edición hecha durante el fetch queda pendiente, no se borra.
      }
      estado('pendiente'); return false;
    })().finally(() => { pendiente = null; });
    return pendiente;
  }
  function conservar() {
    const dueño = leer(OWNER);
    if (dueño && (!cuenta || dueño === cuenta)) recordar(dueño);
  }
  return {
    cargar, guardar, conservar,
    get cuenta() { return cuenta; },
    esCuenta: id => activa && id === cuenta,
    exportar: () => ({ version: 1, ajustes: local(), respaldo: cuenta ? cache(cuenta).respaldoConflicto || null : null }),
  };
}

// El módulo también se importa desde las pruebas sin navegador.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const enCuenta = location.origin === 'https://promt-iota.vercel.app' ||
    /^https:\/\/promt-[a-z0-9]+-iaventassc-5344\.vercel\.app$/.test(location.origin);
  if (enCuenta && window === window.parent) {
    const caja = document.createElement('div'); caja.className = 'settings-sync';
    const mensaje = document.createElement('p'); mensaje.setAttribute('role', 'status'); mensaje.setAttribute('aria-live', 'polite');
    const reintentar = document.createElement('button'); reintentar.type = 'button'; reintentar.className = 'hdr-btn'; reintentar.textContent = 'Sincronizar ahora';
    const descargar = document.createElement('button'); descargar.type = 'button'; descargar.className = 'hdr-btn'; descargar.textContent = 'Descargar mis ajustes';
    caja.append(mensaje, reintentar, descargar);
    document.querySelector('#settings-panel .settings-group:last-child')?.append(caja);
    let primera = true, avisoCombinados = false;
    const mostrar = s => {
      if (s === 'combinados') avisoCombinados = true;
      mensaje.textContent = ({ guardado: avisoCombinados ? 'Ajustes combinados. Se conservaron los valores de tu cuenta; la copia de este dispositivo está en el respaldo.' : 'Tus ajustes están guardados en tu cuenta.',
        guardando: 'Guardando tus ajustes…', pendiente: 'Sin sincronizar. Tus cambios siguen guardados en este dispositivo.',
        local: 'Sin sesión: tus ajustes se guardan en este navegador.', 'sin-espacio': 'No queda espacio en este navegador. Descargá una copia de tus ajustes.',
        'demasiado-grande': 'Tus ajustes superan el tamaño permitido. Descargá una copia para conservarlos.',
        'otra-cuenta': 'Cambió la sesión. Volvé a cargar la página para recuperar los ajustes de tu cuenta.',
        'cambios-remotos': 'Hay cambios de otro dispositivo. Cerrá la escena y tocá Sincronizar ahora para combinarlos.' })[s] || '';
      if (s === 'otra-cuenta') {
        document.documentElement.removeAttribute('data-ajustes-cargando');
        document.documentElement.setAttribute('data-ajustes-error', '');
      }
    };
    const sync = crearSincronizador({ storage: localStorage,
      pedir: (metodo, datos, keepalive) => fetch('/api/versiones?ajustes=1', { method: metodo, cache: 'no-store', signal: AbortSignal.timeout(10000),
        ...(datos ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) } : {}),
        ...(keepalive && datos && new TextEncoder().encode(JSON.stringify(datos)).length < 60000 ? { keepalive: true } : {}),
      }),
      estado: mostrar,
      puedeAplicar: () => primera || (!document.querySelector('.section.open') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')),
      cambiaron: ({ recargar }) => {
        if (recargar) { location.reload(); return; }
        document.documentElement.removeAttribute('data-ajustes-cargando');
        document.documentElement.removeAttribute('data-ajustes-error');
      },
    });
    window.WpAjustes = sync;
    const iniciar = async () => {
      const ok = await sync.cargar(); primera = false;
      if (!ok) {
        // El perfil anterior no se revela ante una identidad sin verificar.
        document.documentElement.removeAttribute('data-ajustes-cargando');
        document.documentElement.setAttribute('data-ajustes-error', '');
      }
    };
    reintentar.addEventListener('click', async () => { await sync.guardar(); await sync.cargar(); });
    descargar.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(sync.exportar(), null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'Wallpaperia-mis-ajustes.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    setInterval(() => { if (!document.hidden) sync.guardar(); }, 1500);
    window.addEventListener('online', iniciar);
    window.addEventListener('focus', () => { sync.guardar().then(() => sync.cargar()); });
    window.addEventListener('pagehide', () => { sync.conservar(); sync.guardar({ keepalive: true }); });
    window.addEventListener('storage', e => {
      if (e.key === OWNER || e.key === 'wp_session_id_v1' || e.key === null) {
        document.documentElement.setAttribute('data-ajustes-cargando', ''); location.reload();
      }
    });
    document.getElementById('ajustes-conexion-reintentar')?.addEventListener('click', () => location.reload());
    iniciar();
  } else document.documentElement.removeAttribute('data-ajustes-cargando');
}
