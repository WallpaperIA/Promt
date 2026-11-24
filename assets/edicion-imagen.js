// Segundos prompts para editar una imagen ya generada. Sin cuerpos de escenas
// ni cambia las preferencias: consume las mismas elecciones de Físico.
(function () {
  'use strict';
  function cambios(persona) {
    const api = globalThis.WpFisico;
    if (!api) return '';
    const { prenda, texto = '' } = persona;
    const s = api.efectivos(persona.figure, prenda, texto);
    const c = api.compatibilidad(prenda, texto);
    const notas = [];
    const volumen = {
      large: 'Aumenta el volumen del busto de forma visible respecto a la imagen anterior.',
      'very-large': 'Aumenta bastante el volumen del busto; que la diferencia respecto a la imagen anterior sea marcada.',
      exaggerated: 'Aumenta mucho el volumen del busto respecto a la imagen anterior; que el aumento se note claramente, con anatomía coherente.',
    };
    if (volumen[s.bust]) notas.push(volumen[s.bust]);
    if (s.fall !== 'none') notas.push(c.estructurada
      ? 'Ajusta la forma de las copas a un perfil ' + (s.fall === 'relaxed' ? 'más relajado' : 'natural') + ', conservando su soporte.'
      : 'Da al busto una caída ' + (s.fall === 'relaxed' ? 'más relajada' : 'natural') + ', acorde al soporte de la prenda.');
    if (s.neckline !== 'none') notas.push(s.neckline === 'wide'
      ? 'Amplía claramente el escote, conservando su forma y la cobertura frontal.'
      : 'Abre un poco más el escote, conservando su forma y la cobertura frontal.');
    if (s.armhole !== 'none') notas.push(c.sinTirantes
      ? 'Amplía ' + (s.armhole === 'wide' ? 'de forma marcada' : 'un poco') + ' el corte lateral superior de la prenda sin tirantes.'
      : 'Amplía ' + (s.armhole === 'wide' ? 'mucho' : 'un poco') + ' las sisas de la prenda para que se distinga el cambio de corte lateral.');
    if (s.fit !== 'none') notas.push(s.fit === 'snug'
      ? 'Da a la prenda un ajuste más ceñido, respetando su tejido y construcción.'
      : 'Adapta la talla y la caída de la prenda al volumen elegido.');
    return notas.join(' ');
  }
  function instruccion({ personas = [], destino = 'all', perfil = false, espejo = false } = {}) {
    const lista = personas.slice(0, 3);
    if (!lista.length) return '';
    const id = i => 'Persona ' + (i + 1) + (lista[i].nombre ? ' (' + JSON.stringify(String(lista[i].nombre)) + ')' : '');
    const grupos = new Map();
    lista.forEach((p, i) => {
      const nota = cambios(p);
      if (!nota) return;
      if (!grupos.has(nota)) grupos.set(nota, []);
      grupos.get(nota).push(id(i));
    });
    const partes = ['Edita la imagen anterior con ' + (lista.length === 1 ? 'el mismo personaje adulto ficticio.' : 'los mismos ' + lista.length + ' personajes adultos ficticios. La numeración corresponde a las personas del prompt original, no a su posición izquierda o derecha.')];
    for (const [nota, quienes] of grupos) partes.push(quienes.join(' y ') + ': ' + nota);
    const indices = lista.map((_, i) => i).filter(i => destino === 'all' || String(i) === String(destino));
    const cambiarPose = perfil && indices.length > 0;
    if (cambiarPose) partes.push(indices.map(id).join(' y ') + ': gira el torso de perfil y levanta los brazos por encima de tu propia cabeza; vuelve el rostro hacia la cámara. Mantén separadas las extremidades de cada persona.');
    partes.push(espejo
      ? 'Todas las personas miran al lente reflejado de la cámara que toma la foto. Conserva los guiños.'
      : 'Todas las personas miran directamente al lente de la cámara. Conserva los guiños.');
    partes.push('Aplica cada cambio sólo a las personas indicadas. Conserva los rostros, pelo, cintura y demás proporciones, material, opacidad, soporte y cobertura frontal de las prendas, fondo, luz y encuadre, salvo los ajustes pedidos.'
      + (cambiarPose ? ' Conserva la pose de las personas sin un cambio de vista indicado.' : ' Conserva todas las poses.'));
    return partes.join('\n\n');
  }
  function montar(host, config) {
    const crear = (tag, clase, texto) => {
      const e = document.createElement(tag);
      if (clase) e.className = clase;
      if (texto) e.textContent = texto;
      return e;
    };
    const caja = crear('details', 'second-prompts');
    caja.appendChild(crear('summary', '', 'Segundos prompts · Ayuda para editar'));
    host.appendChild(caja);
    let contenido = null, vista, estado, preview;
    const vistas = new Map();
    const clave = datos => datos.modo + ':' + datos.destino;
    function actualizar() {
      if (!contenido || !caja.open) return;
      const datos = config.leer();
      vista.value = vistas.get(clave(datos)) || 'original';
      estado.textContent = datos.resumen || 'Físico en Original: el segundo texto sólo corrige la mirada. Elegí ajustes para cambiar volumen, caída o corte.';
      preview.value = instruccion({ ...datos, perfil: vista.value === 'perfil' });
      vista.setAttribute('aria-label', 'Vista para ' + datos.destinoNombre);
    }
    function construir() {
      if (contenido) return;
      contenido = crear('div', 'second-content');
      contenido.appendChild(crear('p', 'second-intro', 'Para personajes adultos ficticios. Generá la imagen base en Gemini y, cuando aparezca, pegá el segundo texto en ese mismo chat.'));
      const base = crear('button', 'second-base', 'Copiar imagen base'); base.type = 'button';
      base.addEventListener('click', () => config.copiarBase());
      contenido.appendChild(base);
      contenido.appendChild(crear('p', 'second-note', 'La base conserva personajes, prenda y escena, sin los ajustes de Físico.'));
      const elegir = crear('button', 'second-settings', 'Elegir ajustes de Físico'); elegir.type = 'button';
      elegir.addEventListener('click', () => config.elegirFisico());
      contenido.appendChild(elegir);
      estado = crear('p', 'second-state'); estado.setAttribute('aria-live', 'polite'); contenido.appendChild(estado);
      const etiqueta = crear('label', 'second-view', 'Vista adicional');
      vista = crear('select');
      for (const [value, text] of [['original', 'Conservar pose y vista'], ['perfil', 'Perfil y brazos arriba']]) {
        const o = crear('option', '', text); o.value = value; vista.appendChild(o);
      }
      vista.addEventListener('change', () => { vistas.set(clave(config.leer()), vista.value); actualizar(); });
      etiqueta.appendChild(vista); contenido.appendChild(etiqueta);
      preview = crear('textarea', 'second-preview'); preview.rows = 8; preview.readOnly = true;
      preview.setAttribute('aria-label', 'Segundo prompt que se copia'); contenido.appendChild(preview);
      const copiar = crear('button', 'second-copy', 'Copiar segundo prompt'); copiar.type = 'button';
      copiar.addEventListener('click', () => { actualizar(); config.copiarSegundo(preview.value); });
      contenido.appendChild(copiar);
      contenido.appendChild(crear('p', 'second-note', 'Revisá la imagen después de cada edición. La vista adicional se aplica al destino elegido en «Modificar a».'));
      caja.appendChild(contenido);
    }
    caja.addEventListener('toggle', () => { if (caja.open) { construir(); actualizar(); } });
    return { actualizar };
  }
  globalThis.WpSegundos = Object.freeze({ cambios, instruccion, montar });
})();
