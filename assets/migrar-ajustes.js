/* Los ajustes viajan entre dos ventanas del mismo navegador. No hay pedidos
   con personajes o textos a un servidor, ni se copian credenciales/cachés. */
(() => {
  const cuenta = 'https://promt-iota.vercel.app';
  const publico = 'https://wallpaperia.github.io';
  const claves = ['wp_chars_v1', 'wp_deleted_v2', 'wp_favs_v1', 'wp_edits_v1', 'wp_stats_v1',
    'wp_compact_v1', 'wp_sort_v1', 'wp_style_v1', 'wp_outfit_v1', 'wp_outfit_favs_v1',
    'wp_hair_v1', 'wp_format_v1', 'wp_details_v1', 'wp_people_v1', 'wp_accent_v1', 'wp_vip_theme_v1',
    'wp_lp_collapsed_v1', 'wp_edad_v1'];
  if (location.origin === publico && location.pathname === '/Promt/migrar-ajustes.html') {
    addEventListener('message', event => {
      if (event.origin !== cuenta || event.source !== opener || !opener || event.data?.tipo !== 'wp-pedir-ajustes') return;
      const datos = {};
      let bytes = 0;
      for (const clave of claves) {
        const valor = localStorage.getItem(clave);
        if (valor !== null && bytes + valor.length <= 400000) { datos[clave] = valor; bytes += valor.length; }
      }
      opener.postMessage({ tipo: 'wp-ajustes-locales', nonce: event.data.nonce, datos }, cuenta);
    });
    if (opener) opener.postMessage({ tipo: 'wp-ajustes-listos' }, cuenta);
    return;
  }
  if (location.origin !== cuenta || parent !== window) return;

  // Antes se salteaba en silencio toda clave que ya existiera acá y se
  // respondía "Ajustes recuperados": quien había creado un personaje en la
  // cuenta perdía todos los del enlace anterior sin enterarse. Ahora las
  // listas se unen y los mapas suman lo que falta; lo que ya está acá con
  // otro valor se conserva y se cuenta, para decir qué no se trajo.
  const LISTAS = ['wp_favs_v1', 'wp_outfit_favs_v1', 'wp_deleted_v2'];
  const MAPAS = ['wp_edits_v1', 'wp_stats_v1', 'wp_people_v1'];
  const leer = (texto, lista) => {
    try {
      const v = JSON.parse(texto);
      if (lista) return Array.isArray(v) ? v : null;
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch { return null; }
  };
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function combinar(clave, actual, traido) {
    if (actual === traido) return { agregados: 0, conservados: 0 };
    if (clave === 'wp_chars_v1' || LISTAS.includes(clave)) {
      const t = leer(traido, true);
      if (!t) return { agregados: 0, conservados: 0 };
      const a = actual === null ? [] : leer(actual, true);
      // Si lo de acá está dañado no se toca: se cuenta como conservado.
      if (!a) return { agregados: 0, conservados: 1 };
      const id = clave === 'wp_chars_v1'
        ? x => (x && typeof x.name === 'string' ? x.name : null)
        : x => (typeof x === 'string' ? x : null);
      const previos = new Map(a.map(x => [id(x), x]));
      const suma = [];
      let conservados = 0;
      for (const x of t) {
        const k = id(x);
        if (k === null) continue;
        if (!previos.has(k)) { previos.set(k, x); suma.push(x); }
        else if (!igual(previos.get(k), x)) conservados++;
      }
      return { valor: suma.length ? JSON.stringify([...a, ...suma]) : undefined, agregados: suma.length, conservados };
    }
    if (MAPAS.includes(clave)) {
      const t = leer(traido, false);
      if (!t) return { agregados: 0, conservados: 0 };
      const a = actual === null ? {} : leer(actual, false);
      if (!a) return { agregados: 0, conservados: 1 };
      let agregados = 0, conservados = 0;
      const suma = { ...a };
      for (const [k, v] of Object.entries(t)) {
        if (!Object.prototype.hasOwnProperty.call(a, k)) { suma[k] = v; agregados++; }
        else if (!igual(a[k], v)) conservados++;
      }
      return { valor: agregados ? JSON.stringify(suma) : undefined, agregados, conservados };
    }
    // Preferencias sueltas (color, orden, estilo...): manda lo de acá.
    if (actual === null) return { valor: traido, agregados: 1, conservados: 0 };
    return { agregados: 0, conservados: 1 };
  }

  const MARCA = 'wp_migracion_v1';
  const RESUMEN = 'wp_migracion_resumen';
  const aviso = document.getElementById('aviso-ajustes');
  const textoAviso = aviso?.querySelector('p');
  const botonAviso = aviso?.querySelector('[data-traer-ajustes]');
  const recordar = () => { try { localStorage.setItem(MARCA, '1'); } catch {} };
  // final: el resumen después de traerlos, sin el botón. Un error deja el
  // botón para reintentar.
  const mostrarAviso = (texto, final = false) => {
    if (!aviso) return;
    if (texto) textoAviso.textContent = texto;
    if (botonAviso) botonAviso.hidden = final;
    aviso.hidden = false;
  };

  const grupo = document.querySelector('#settings-panel .settings-group:last-child');
  // Una ventana de primer nivel conserva acceso al almacenamiento anterior
  // también cuando el navegador particiona el de los iframes de terceros.
  const boton = document.createElement('button');
  boton.type = 'button'; boton.className = 'hdr-btn';
  boton.textContent = 'Traer mis ajustes anteriores';
  boton.title = 'Recuperar personajes, favoritas y ajustes del enlace anterior de Wallpaperia';
  grupo?.appendChild(boton);

  let ventana = null, nonce = null, espera = null;
  const informar = texto => {
    boton.textContent = texto;
    if (aviso && !aviso.hidden) mostrarAviso(texto);
  };
  function traer() {
    nonce = crypto.randomUUID();
    ventana = window.open(publico + '/Promt/migrar-ajustes.html', 'wp-ajustes-locales', 'popup,width=480,height=360');
    if (!ventana) { informar('El navegador bloqueó la ventana. Permití ventanas emergentes y reintentá.'); return; }
    clearTimeout(espera);
    espera = setTimeout(() => {
      try { ventana?.close(); } catch {}
      ventana = null; nonce = null;
      informar('No se pudieron leer los ajustes anteriores. Reintentá.');
    }, 15000);
  }
  boton.addEventListener('click', traer);
  botonAviso?.addEventListener('click', traer);
  aviso?.querySelector('[data-cerrar-aviso-ajustes]')?.addEventListener('click', () => { recordar(); aviso.hidden = true; });

  addEventListener('message', event => {
    if (!ventana || event.origin !== publico || event.source !== ventana) return;
    if (event.data?.tipo === 'wp-ajustes-listos') {
      ventana.postMessage({ tipo: 'wp-pedir-ajustes', nonce }, publico);
      return;
    }
    if (event.data?.tipo !== 'wp-ajustes-locales' || event.data.nonce !== nonce) return;
    const datos = event.data.datos;
    if (!datos || typeof datos !== 'object') return;
    clearTimeout(espera);
    let bytes = 0, agregados = 0, conservados = 0, cambios = 0;
    for (const clave of claves) {
      const valor = datos[clave];
      if (typeof valor !== 'string' || (bytes += valor.length) > 400000) continue;
      const r = combinar(clave, localStorage.getItem(clave), valor);
      agregados += r.agregados; conservados += r.conservados;
      if (r.valor !== undefined) {
        try { localStorage.setItem(clave, r.valor); cambios++; } catch { conservados++; }
      }
    }
    ventana.close(); ventana = null; nonce = null;
    recordar();
    const resumen = (cambios ? 'Ajustes recuperados.' : 'No había ajustes nuevos para traer.')
      + (conservados ? ' Se conservaron ' + conservados + (conservados === 1 ? ' dato' : ' datos')
        + ' que ya tenías acá con otro valor.' : '');
    if (cambios) {
      // La página lee estos ajustes al cargar: hay que recargar para verlos.
      // El resumen sobrevive a la recarga para que se pueda leer.
      try { sessionStorage.setItem(RESUMEN, resumen); } catch {}
      location.reload();
    } else informar(resumen);
  });

  // Después de recargar por una migración, se muestra qué pasó.
  let pendiente = null;
  try { pendiente = sessionStorage.getItem(RESUMEN); sessionStorage.removeItem(RESUMEN); } catch {}
  if (pendiente) { mostrarAviso(pendiente, true); boton.textContent = pendiente; return; }
  // La primera vez en el origen de cuenta se ofrece sola: el botón de Ajustes
  // queda escondido justo cuando alguien busca sus personajes y no los ve.
  // Abrir la ventana necesita un clic: por eso es un aviso y no automático.
  // Se recuerda al mostrarlo: sólo la primera vez, aunque no se toque nada.
  // Después sigue en Ajustes.
  let visto = true;
  try { visto = localStorage.getItem(MARCA) !== null; } catch {}
  if (!visto) { mostrarAviso(); recordar(); }
})();
