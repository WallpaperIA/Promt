// Motor de texto compartido. Recibe la configuración completa: no consulta
// el DOM ni las preferencias del navegador y no contiene cuerpos privados.
(function () {
  'use strict';
  function cambiarEstilo(texto, estilo, estilos = []) {
    if (!estilo?.prefix) return texto;
    const anteriores = estilos.map(s => s.prefix).filter(Boolean).sort((a, b) => b.length - a.length);
    const anterior = anteriores.find(p => texto.startsWith(p));
    if (anterior) return estilo.prefix + texto.slice(anterior.length);
    // Una frase «of» puede estar dentro de la pose o el fondo. No se corta
    // una introducción desconocida: el nombre puede estar antes de esa frase.
    return estilo.prefix + '\n\n' + texto;
  }
  function cambiarPeinado(texto, peinado) {
    return peinado?.instruction ? texto + ' Hairstyle note: ' + peinado.instruction + ' Keep her natural hair color.' : texto;
  }
  function agregarDetalles(texto, detalles = []) {
    const notas = detalles.map(d => d?.prompt).filter(Boolean);
    return notas.length ? texto.trimEnd() + '\n\nAdditional details: ' + notas.join(', ') + '.' : texto;
  }
  function construir(texto, opciones, reglas) {
    const { modo = 'solo', nombres = [], style, outfit = 'none', hair = 'none', format = '16-9', details = [], figure = {}, people = {} } = opciones;
    const estilo = reglas.estilos.find(s => s.id === style) || reglas.estilos[0];
    const ids = Array.from(details);
    let t = cambiarEstilo(texto, estilo, reglas.estilos);
    if (modo === 'solo') {
      t = reglas.cambiarPrenda(t, outfit, nombres);
      t = cambiarPeinado(t, reglas.peinados.find(p => p.id === hair));
      t = agregarDetalles(t, ids.map(id => reglas.detalles.find(d => d.id === id)));
      if (reglas.fisico) t = reglas.fisico.aplicar(t, figure, reglas.obtenerPrenda(outfit));
    } else {
      t = reglas.aplicarPersonas(t, modo, nombres, { outfit, hair, details: ids, figure }, people);
    }
    const formato = reglas.formatos.find(f => f.id === format);
    if (formato && format !== '16-9') t = reglas.cambiarFormato(t, formato);
    return reglas.aplicarMedio(t, estilo?.id);
  }
  globalThis.WpTextoEscena = Object.freeze({ cambiarEstilo, cambiarPeinado, agregarDetalles, construir });
})();
