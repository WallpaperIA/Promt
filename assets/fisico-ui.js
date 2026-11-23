(function () {
  'use strict';
  function montar(host, config) {
    const api = globalThis.WpFisico;
    const crear = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto) e.textContent = texto; return e; };
    const intro = crear('p', 'figure-intro', 'Ajustes opcionales para personajes adultos ficticios. Cada control cambia sólo su atributo.');
    const volumen = crear('fieldset', 'figure-volume');
    volumen.appendChild(crear('legend', '', 'Volumen de busto'));
    const grid = crear('div', 'figure-volume-grid'), botones = new Map();
    for (const o of api.OPCIONES.bust) {
      const b = crear('button', 'figure-choice', o.name); b.type = 'button';
      b.dataset.value = o.id; b.setAttribute('aria-label', 'Volumen de busto: ' + o.name); b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => config.cambiar('bust', o.id)); grid.appendChild(b); botones.set(o.id, b);
    }
    volumen.appendChild(grid);
    const notaVolumen = crear('p', 'figure-help');
    const campos = crear('div', 'figure-fields'), selects = new Map(), ayudas = new Map();
    for (const k of api.CAMPOS.filter(k => k !== 'bust')) {
      const label = crear('label', 'figure-field'); label.appendChild(crear('span', '', api.TITULOS[k]));
      const select = crear('select'); select.setAttribute('aria-label', api.TITULOS[k] + ' del físico');
      for (const o of api.OPCIONES[k]) { const n = crear('option', '', o.name); n.value = o.id; select.appendChild(n); }
      select.addEventListener('change', () => config.cambiar(k, select.value));
      const ayuda = crear('span', 'figure-help'); label.appendChild(select); label.appendChild(ayuda); campos.appendChild(label);
      selects.set(k, select); ayudas.set(k, ayuda);
    }
    const estado = crear('p', 'figure-status'); estado.setAttribute('role', 'status'); estado.setAttribute('aria-live', 'polite');
    const reset = crear('button', 'figure-reset', 'Restaurar físico original'); reset.type = 'button'; reset.addEventListener('click', config.restaurar);
    host.appendChild(intro); host.appendChild(volumen); host.appendChild(notaVolumen); host.appendChild(campos); host.appendChild(estado); host.appendChild(reset);
    function actualizar() {
      const s = api.normalizar(config.leer()), c = config.capacidades();
      for (const [id, b] of botones) { const on = s.bust === id; b.disabled = false; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); }
      notaVolumen.textContent = c.reasons.bust || 'Los niveles describen diferencias de volumen, sin prometer una copa exacta.';
      for (const [k, select] of selects) { select.value = s[k]; select.disabled = false; ayudas.get(k).textContent = c.reasons[k] || ''; }
      const omitidos = api.CAMPOS.filter(k => s[k] !== 'none' && !c[k]);
      estado.textContent = (omitidos.length ? 'Se conservan tus elecciones. No se aplican a esta prenda: ' + omitidos.map(k => api.TITULOS[k].toLowerCase()).join(', ') + '.' : 'El encuadre y los demás atributos se conservan.') + ' La ropa rígida, los brazos cruzados o un objeto frente al torso pueden disimular el cambio.';
      reset.disabled = false;
    }
    actualizar(); return { actualizar };
  }
  globalThis.WpFisicoUI = Object.freeze({ montar });
})();
