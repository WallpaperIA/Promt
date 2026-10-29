import { crearAlmacenCreacion, CANDADOS_INICIALES, VERSION_NOVEDADES, sorprender, resolverPersonas, versionesColeccion, escenasNuevas, normalizarCombinacion } from './creacion-datos.js';

const el = (tag, clase, texto) => { const n = document.createElement(tag); if (clase) n.className = clase; if (texto !== undefined) n.textContent = texto; return n; };
const boton = (texto, fn, clase = 'hdr-btn') => { const b = el('button', clase, texto); b.type = 'button'; b.addEventListener('click', fn); return b; };
const opcion = (select, valor, texto) => { const o = el('option', '', texto); o.value = valor; select.append(o); };
const nombreModo = s => ({ solo: 'Solo', duo: 'Dúo', trio: 'Trío' })[s];
const uuid = () => crypto.randomUUID();
export function iniciarCreacion(config) {
  const store = crearAlmacenCreacion(localStorage);
  const combos = () => store.leer('wp_combinations_v1', {});
  const colecciones = () => store.leer('wp_collections_v1', { folders: {}, versions: {} });
  const locks = () => ({ ...CANDADOS_INICIALES, ...store.leer('wp_random_locks_v1', {}) });
  const vistas = () => store.leer('wp_news_v1', { release: '', scenes: {} });
  const mensajeGuardado = () => globalThis.WpAjustes?.cuenta ? 'Guardado en este dispositivo · sincronizando con tu cuenta.' : 'Guardado en este navegador. Entrá con Patreon para recuperarlo en otros dispositivos.';
  function guardar(k, x) {
    const ok = store.guardar(k, x);
    if (!ok) config.aviso('No se pudo guardar. Revisá el espacio disponible o el límite de elementos.');
    return ok;
  }
  const cerrarAjustes = () => { document.getElementById('settings-panel').classList.remove('open'); document.getElementById('settings-btn').setAttribute('aria-expanded', 'false'); };
  function dialogo(titulo, descripcion) {
    const d = el('dialog', 'creation-dialog');
    const cab = el('div', 'creation-head'), h = el('h2', '', titulo), info = el('div');
    h.id = 'creation-' + uuid(); d.setAttribute('aria-labelledby', h.id);
    info.append(h, el('p', 'creation-muted', descripcion));
    const cerrar = boton('Cerrar', () => d.close()); cerrar.setAttribute('aria-label', 'Cerrar ' + titulo);
    cab.append(info, cerrar); d.append(cab); document.body.append(d);
    let foco;
    d.addEventListener('close', () => { if (foco?.isConnected) foco.focus(); });
    d.addEventListener('click', e => { if (e.target !== d) return; const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); });
    return { nodo: d, abrir() { cerrarAjustes(); foco = document.activeElement; d.showModal(); cerrar.focus(); } };
  }

  const biblioteca = dialogo('Mis combinaciones', 'Guardá los controles y volvé a usarlos en cualquier escena.');
  const contexto = el('p', 'creation-context');
  const formulario = el('form', 'creation-form');
  const etiqueta = el('label', '', 'Nombre de la combinación');
  const entrada = el('input'); entrada.maxLength = 80; entrada.required = true; entrada.autocomplete = 'off'; entrada.placeholder = 'Por ejemplo: Trío editorial'; etiqueta.append(entrada);
  const guardarBtn = el('button', 'edit-save-btn', 'Guardar combinación actual'); guardarBtn.type = 'submit';
  const cancelar = boton('Cancelar cambio de nombre', () => { renombrando = null; entrada.value = ''; pintarBiblioteca(); }); cancelar.hidden = true;
  formulario.append(etiqueta, guardarBtn, cancelar);
  const privacidad = el('p', 'creation-muted', 'Al guardar, los nombres y ajustes de esta combinación se incluyen en tus ajustes privados. No guarda el texto del prompt ni las fotos.');
  const busqueda = el('input'); busqueda.type = 'search'; busqueda.placeholder = 'Buscar combinación…'; busqueda.setAttribute('aria-label', 'Buscar combinación');
  const lista = el('div', 'creation-list');
  const estado = el('p', 'creation-muted'); estado.setAttribute('role', 'status');
  biblioteca.nodo.append(contexto, formulario, privacidad, busqueda, lista, estado);
  let renombrando = null;
  function pintarBiblioteca() {
    const escena = config.activa();
    contexto.textContent = escena ? 'Aplicar en: ' + escena.nombre : 'Abrí una escena para aplicar una combinación, o abrí su escena de origen.';
    guardarBtn.disabled = !escena && !renombrando;
    guardarBtn.textContent = renombrando ? 'Guardar nombre' : 'Guardar combinación actual';
    cancelar.hidden = !renombrando;
    lista.replaceChildren();
    const todas = Object.entries(combos()).sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
    const filtradas = todas.filter(([, c]) => c.name.toLocaleLowerCase('es').includes(busqueda.value.toLocaleLowerCase('es')));
    if (!filtradas.length) lista.append(el('p', 'creation-muted', todas.length ? 'No hay combinaciones con ese nombre.' : 'Tu primera combinación puede empezar con los ajustes de la escena abierta.'));
    for (const [id, c] of filtradas) {
      const fila = el('article', 'creation-item');
      fila.append(el('h3', '', c.name), el('p', 'creation-muted', nombreModo(c.mode) + ' · ' + c.characters.filter(Boolean).join(' · ')));
      const acciones = el('div', 'creation-actions');
      const usar = boton(escena ? 'Aplicar en esta escena' : 'Abrir y aplicar', () => {
        if (escena) escena.aplicar(c); else config.abrir(c.catId, c);
        biblioteca.nodo.close();
      });
      usar.disabled = !escena && !config.catalogo().some(x => x.id === c.catId);
      acciones.append(usar, boton('Renombrar', () => { renombrando = id; entrada.value = c.name; pintarBiblioteca(); entrada.focus(); }),
        boton('Eliminar', () => { if (!confirm('¿Eliminar la combinación «' + c.name + '»?')) return; const datos = combos(); delete datos[id]; if (guardar('wp_combinations_v1', datos)) { if (renombrando === id) renombrando = null; pintarBiblioteca(); estado.textContent = mensajeGuardado(); } }));
      fila.append(acciones); lista.append(fila);
    }
    if (!estado.textContent) estado.textContent = todas.length + ' de 80 combinaciones · ' + (globalThis.WpAjustes?.cuenta ? 'Cuenta privada' : 'Este navegador');
  }
  formulario.addEventListener('submit', e => {
    e.preventDefault(); if (!formulario.reportValidity()) return;
    const datos = combos(), escena = config.activa(), name = entrada.value.trim(); if (!name) return;
    if (renombrando) { if (!datos[renombrando]) return; datos[renombrando].name = name; }
    else { if (!escena) return; if (Object.keys(datos).length >= 80) { estado.textContent = 'Llegaste a 80 combinaciones. Eliminá una para guardar otra.'; return; } datos[uuid()] = { ...escena.leer(), name }; }
    if (guardar('wp_combinations_v1', datos)) { renombrando = null; entrada.value = ''; pintarBiblioteca(); estado.textContent = mensajeGuardado(); }
  });
  busqueda.addEventListener('input', pintarBiblioteca);
  function abrirBiblioteca() { renombrando = null; entrada.value = ''; busqueda.value = ''; estado.textContent = ''; pintarBiblioteca(); biblioteca.abrir(); }
  const accionesAjustes = document.querySelector('#settings-panel .header-actions');
  accionesAjustes.append(boton('Mis combinaciones', abrirBiblioteca));

  // Colecciones: sólo organización de las copias del dueño. Sus cuerpos siguen en la API privada existente.
  const gestor = dialogo('Mis colecciones', 'Organizá tus versiones privadas por tema.');
  const coleccionForm = el('form', 'creation-form'), coleccionLabel = el('label', '', 'Nombre de la colección'), coleccionNombre = el('input');
  coleccionNombre.maxLength = 80; coleccionNombre.required = true; coleccionNombre.autocomplete = 'off'; coleccionLabel.append(coleccionNombre);
  const crearColeccion = el('button', 'edit-save-btn', 'Crear colección'); crearColeccion.type = 'submit';
  const cancelarColeccion = boton('Cancelar cambio de nombre', () => { carpetaEditada = null; coleccionNombre.value = ''; pintarColecciones(); }); cancelarColeccion.hidden = true;
  coleccionForm.append(coleccionLabel, crearColeccion, cancelarColeccion);
  const carpetasLista = el('div', 'creation-list'), carpetasEstado = el('p', 'creation-muted'); carpetasEstado.setAttribute('role', 'status');
  gestor.nodo.append(coleccionForm, carpetasLista, carpetasEstado);
  const filtroLabel = el('label', 'creation-field', 'Colección'), filtro = el('select'); filtro.setAttribute('aria-label', 'Filtrar versiones por colección'); filtroLabel.append(filtro);
  document.querySelector('.versions-browse').prepend(filtroLabel, boton('Administrar colecciones', () => { pintarColecciones(); gestor.abrir(); }));
  const asignarLabel = el('label', 'creation-field', 'Guardar en colección'), asignar = el('select'); asignar.setAttribute('aria-label', 'Colección de esta versión'); asignarLabel.append(asignar);
  document.getElementById('versions-form').insertBefore(asignarLabel, document.getElementById('versions-body').previousElementSibling);
  let carpetaEditada = null;
  function pintarColecciones() {
    const datos = colecciones(), valor = filtro.value, elegida = asignar.value;
    filtro.replaceChildren(); asignar.replaceChildren(); opcion(filtro, '', 'Todas las colecciones'); opcion(filtro, 'unfiled', 'Sin colección'); opcion(asignar, '', 'Sin colección');
    carpetasLista.replaceChildren();
    for (const [id, c] of Object.entries(datos.folders).sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'))) {
      opcion(filtro, id, c.name); opcion(asignar, id, c.name);
      const fila = el('article', 'creation-item'), acciones = el('div', 'creation-actions');
      fila.append(el('h3', '', c.name));
      acciones.append(boton('Renombrar', () => { carpetaEditada = id; coleccionNombre.value = c.name; pintarColecciones(); coleccionNombre.focus(); }), boton('Eliminar colección', () => {
        if (!confirm('¿Eliminar «' + c.name + '»? Sus versiones se conservan en Sin colección.')) return;
        const actual = colecciones(); delete actual.folders[id]; for (const [v, f] of Object.entries(actual.versions)) if (f === id) delete actual.versions[v];
        if (guardar('wp_collections_v1', actual)) { if (carpetaEditada === id) carpetaEditada = null; pintarColecciones(); config.coleccionesCambiaron(); }
      }));
      fila.append(acciones); carpetasLista.append(fila);
    }
    if (!Object.keys(datos.folders).length) carpetasLista.append(el('p', 'creation-muted', 'Creá una colección y asigná tus versiones desde Mis versiones.'));
    filtro.value = valor === 'unfiled' || datos.folders[valor] ? valor : '';
    asignar.value = datos.folders[elegida] ? elegida : '';
    crearColeccion.textContent = carpetaEditada ? 'Guardar nombre' : 'Crear colección'; cancelarColeccion.hidden = !carpetaEditada;
  }
  coleccionForm.addEventListener('submit', e => {
    e.preventDefault(); if (!coleccionForm.reportValidity()) return;
    const d = colecciones(), name = coleccionNombre.value.trim(); if (!name) return;
    if (!carpetaEditada && Object.keys(d.folders).length >= 40) { carpetasEstado.textContent = 'Llegaste a 40 colecciones.'; return; }
    d.folders[carpetaEditada || uuid()] = { name };
    if (guardar('wp_collections_v1', d)) { carpetaEditada = null; coleccionNombre.value = ''; pintarColecciones(); carpetasEstado.textContent = mensajeGuardado(); config.coleccionesCambiaron(); }
  });
  filtro.addEventListener('change', config.coleccionesCambiaron);
  function asignarVersion(id) {
    const d = colecciones(); if (asignar.value && d.folders[asignar.value]) d.versions[id] = asignar.value; else delete d.versions[id];
    return guardar('wp_collections_v1', d);
  }
  asignar.addEventListener('change', () => { const v = config.versionActual(); if (v?.id && asignarVersion(v.id)) { config.aviso(mensajeGuardado()); config.coleccionesCambiaron(); } });
  accionesAjustes.append(boton('Mis colecciones', () => { pintarColecciones(); gestor.abrir(); }));
  pintarColecciones();

  const noticias = dialogo('Novedades', 'Lo nuevo en Wallpaperia.');
  const novedadesLista = el('div', 'creation-list'); noticias.nodo.append(novedadesLista);
  const botonNoticias = boton('Novedades', abrirNoticias); accionesAjustes.append(botonNoticias);
  // También visible sin abrir Ajustes.
  const noticiasCatalogo = boton('Novedades', abrirNoticias); noticiasCatalogo.classList.add('creation-news-button');
  document.querySelector('.catalogo-vistas')?.append(noticiasCatalogo);
  function actualizarNoticias() {
    if (!config.catalogoListo() || document.documentElement.hasAttribute('data-ajustes-cargando') || document.documentElement.hasAttribute('data-ajustes-error')) return;
    if (localStorage.getItem('wp_news_v1') === null) {
      const scenes = Object.fromEntries(config.catalogo().filter(c => c.ready !== false).map(c => [c.id, true]));
      guardar('wp_news_v1', { release: '', scenes });
    }
    const v = vistas(), n = escenasNuevas(config.catalogo(), v.scenes).length + (v.release === VERSION_NOVEDADES ? 0 : 1);
    for (const b of [botonNoticias, noticiasCatalogo]) { b.textContent = 'Novedades' + (n ? ' · ' + n : ''); b.setAttribute('aria-label', 'Novedades' + (n ? ': ' + n + ' sin leer' : '')); }
  }
  function abrirNoticias() {
    novedadesLista.replaceChildren();
    const release = el('article', 'creation-item'); release.append(el('h3', '', 'Creá, guardá y volvé a combinar'), el('p', 'creation-muted', '29 de octubre de 2026'));
    for (const t of ['Mis combinaciones: guardá personajes y controles para otra escena.', 'Sorpréndeme con candados para conservar tus elecciones.', 'Resumen de prendas, peinados y extras de cada persona.', 'Colecciones para ordenar tus versiones privadas.', 'Ajustes sincronizados con tu cuenta y novedades del catálogo.']) release.append(el('p', '', t));
    novedadesLista.append(release);
    if (!config.catalogoListo()) novedadesLista.append(el('p', 'creation-muted', 'El catálogo todavía está cargando. Volvé a abrir Novedades en unos segundos.'));
    const v = vistas(), nuevas = escenasNuevas(config.catalogo(), v.scenes);
    const recientes = [...config.catalogo()].filter(c => c.ready !== false).slice(-12).reverse();
    const mostrar = nuevas.length ? nuevas.slice().reverse() : recientes;
    novedadesLista.append(el('h3', '', nuevas.length ? 'Escenas nuevas desde tu última visita' : 'Escenas para explorar'));
    for (const c of mostrar) novedadesLista.append(boton(config.nombre(c.name), () => { noticias.nodo.close(); config.abrir(c.id); }, 'creation-scene-link'));
    noticias.abrir();
    if (config.catalogoListo()) { guardar('wp_news_v1', { release: VERSION_NOVEDADES, scenes: Object.fromEntries(config.catalogo().filter(c => c.ready !== false).map(c => [c.id, true])) }); actualizarNoticias(); }
  }
  document.addEventListener('wp-catalogo-actualizado', actualizarNoticias); actualizarNoticias();
  new MutationObserver(actualizarNoticias).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ajustes-cargando', 'data-ajustes-error'] });

  function montarEscena(escena) {
    const herramientas = el('section', 'creation-tools'); herramientas.setAttribute('aria-label', 'Crear combinaciones');
    const fila = el('div', 'creation-actions');
    fila.append(boton('Mis combinaciones', abrirBiblioteca), boton('Sorpréndeme', () => {
      const actual = escena.leer(), candados = locks(), nombres = config.personajes();
      escena.aplicar(sorprender(actual, candados, config.catalogos, config.permite, nombres));
      if (!candados.characters && new Set(nombres).size < actual.characters.length) config.aviso('Se conservaron los personajes: guardá más nombres en Mis personajes para sortearlos.');
      else config.aviso('Nueva combinación. Los candados conservan tus elecciones.');
    }, 'edit-save-btn'));
    const candados = el('details', 'creation-locks'); candados.append(el('summary', '', 'Candados · conservar al sorprender'));
    const candadosLista = el('div', 'creation-lock-grid');
    const checks = new Map();
    for (const [k, texto] of [['characters', 'Personajes'], ['outfit', 'Prenda'], ['hair', 'Peinado'], ['details', 'Extras'], ['style', 'Estilo'], ['format', 'Formato']]) {
      const label = el('label'), check = el('input'); check.type = 'checkbox'; check.checked = locks()[k]; check.setAttribute('aria-label', 'Conservar ' + texto.toLowerCase() + ' al sorprender');
      check.addEventListener('change', () => { const v = locks(); v[k] = check.checked; if (!guardar('wp_random_locks_v1', v)) check.checked = !check.checked; });
      checks.set(k, check); label.append(check, document.createTextNode(texto)); candadosLista.append(label);
    }
    candados.append(candadosLista); herramientas.append(fila, candados);
    escena.host.prepend(herramientas);
    const resumen = el('div', 'creation-people'); resumen.setAttribute('aria-label', 'Resumen de cada persona');
    escena.host.querySelector('.det-resumen')?.after(resumen);
    escena.actualizar = () => {
      const s = escena.leer(); resumen.hidden = s.mode === 'solo';
      for (const [k, check] of checks) check.checked = locks()[k];
      if (resumen.hidden) { resumen.replaceChildren(); resumen.dataset.firma = ''; return; }
      const personas = resolverPersonas(s, config.catalogos.personal);
      // No reconstruir controles al teclear si su contenido sigue igual.
      const firma = JSON.stringify(personas); if (resumen.dataset.firma === firma) return; resumen.dataset.firma = firma; resumen.replaceChildren();
      personas.forEach((p, i) => {
        const card = el('article', 'creation-person');
        card.append(el('h3', '', 'Persona ' + (i + 1)), el('p', 'creation-person-name', p.name));
        for (const [tipo, valor, lista] of [['Prenda', p.outfit, config.catalogos.outfits], ['Peinado', p.hair, config.catalogos.hairs]]) card.append(el('p', '', tipo + ': ' + (lista.find(x => x.id === valor)?.name || 'Original')));
        const extras = p.details.map(id => config.catalogos.details.find(d => d.id === id)?.name).filter(Boolean);
        card.append(el('p', '', 'Extras: ' + (extras.join(', ') || 'Ninguno')), boton('Modificar persona ' + (i + 1), () => escena.editar(i)));
        resumen.append(card);
      });
    };
    escena.actualizar();
  }
  // La sesión y la sincronización conservan el aislamiento existente; ningún diálogo mantiene copias tras un cambio.
  window.addEventListener('storage', e => { if (e.key === 'wp_session_id_v1' || e.key === 'wp_settings_owner_v1' || e.key === null) for (const d of [biblioteca, gestor, noticias]) { d.nodo.close(); if (d !== noticias) d.nodo.querySelectorAll('input').forEach(x => { x.value = ''; }); } });
  return { montarEscena,
    normalizar: c => normalizarCombinacion(c, config.catalogos, config.permite),
    filtrarVersiones: lista => versionesColeccion(lista, colecciones(), filtro.value),
    nombreColeccion(id) { const d = colecciones(); return d.folders[d.versions[id]]?.name || ''; },
    editarVersion() { pintarColecciones(); const v = config.versionActual(); const d = colecciones(); asignar.value = v?.id && d.folders[d.versions[v.id]] ? d.versions[v.id] : ''; },
    guardarVersion: asignarVersion,
    eliminarVersion(id) { const d = colecciones(); delete d.versions[id]; guardar('wp_collections_v1', d); },
  };
}
