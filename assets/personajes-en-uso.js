// Nombres visibles al recorrer escenas en esta pestaña. Sólo memoria de la
// página: no se guardan en disco ni se sincronizan con otra cuenta.
(function () {
  'use strict';
  const cantidad = { solo: 1, duo: 2, trio: 3 };
  const nombres = new Map();
  function leer(modo) { return (nombres.get(modo) || Array(cantidad[modo] || 0).fill('')).slice(); }
  function guardar(modo, valores) {
    if (!cantidad[modo] || !Array.isArray(valores)) return;
    nombres.set(modo, Array.from({ length: cantidad[modo] }, (_, i) => typeof valores[i] === 'string' ? valores[i].trim() : ''));
  }
  function vincular(modo, campos) {
    function refrescar() {
      const previos = leer(modo);
      campos.forEach((campo, i) => { campo.value = previos[i] || ''; });
    }
    refrescar();
    campos.forEach(campo => {
      campo.addEventListener('input', () => guardar(modo, campos.map(c => c.value)));
    });
    return refrescar;
  }
  globalThis.WpPersonajesEnUso = Object.freeze({ leer, guardar, vincular });
})();
