// Reglas puras compartidas por el script clásico del navegador y los módulos
// de preferencias de la API. Sólo opciones públicas; nunca cuerpos de escenas.
(function () {
  'use strict';
  const CAMPOS = ['bust', 'fall', 'neckline', 'armhole', 'fit'];
  const OPCIONES = {
    bust: [
      { id: 'none', name: 'Original', instruction: '' },
      { id: 'large', name: 'Grande', instruction: 'Use a full bust with a clear, moderate increase in bust volume, keeping the same torso, shoulders and waist.' },
      { id: 'very-large', name: 'Muy grande', instruction: 'Use a very full bust with a pronounced increase in bust volume relative to the same torso and shoulders. Keep the waist and the rest of the figure unchanged.' },
      { id: 'exaggerated', name: 'Exagerado', instruction: 'Use an exaggerated fashion silhouette with a markedly fuller bust and a strong increase in bust volume relative to the same torso and shoulders. Keep believable anatomy, the original waist and the rest of the figure unchanged.' },
    ],
    fall: [
      { id: 'none', name: 'Original', instruction: '' },
      { id: 'natural', name: 'Natural', instruction: 'Use a natural bust profile with realistic gravitational settling and fabric drape consistent with the support provided by the actual garment.' },
      { id: 'relaxed', name: 'Relajada', instruction: 'Use a softer, more relaxed bust profile and softer fabric drape, respecting the support actually provided by this garment. Do not add or remove support elements.' },
    ],
    neckline: [
      { id: 'none', name: 'Original', instruction: '' },
      { id: 'open', name: 'Más abierto', instruction: 'Make the existing neckline slightly more open while retaining its neckline shape, straps and closures.' },
      { id: 'wide', name: 'Muy abierto', instruction: 'Make the existing neckline noticeably more open while retaining its neckline shape, straps, closures and covered front panels.' },
    ],
    armhole: [
      { id: 'none', name: 'Original', instruction: '' },
      { id: 'open', name: 'Amplia', instruction: 'Slightly enlarge the existing armhole openings along their outer edges, retaining the straps, side seams and covered front panels.' },
      { id: 'wide', name: 'Más amplia', instruction: 'Noticeably widen the existing armhole openings while keeping the straps, side seams and covered front panels in place. Keep the garment wearable.' },
    ],
    fit: [
      { id: 'none', name: 'Original', instruction: '' },
      { id: 'volume', name: 'Adaptar al volumen', instruction: 'Adapt the existing garment fit to the selected figure without adding extra tightness.' },
      { id: 'snug', name: 'Más ceñido', instruction: 'Give the existing garment a closer fit around the selected figure.' },
    ],
  };
  for (const lista of Object.values(OPCIONES)) { lista.forEach(Object.freeze); Object.freeze(lista); }
  Object.freeze(OPCIONES); Object.freeze(CAMPOS);
  const TITULOS = Object.freeze({ bust: 'Volumen de busto', fall: 'Caída', neckline: 'Escote', armhole: 'Sisa', fit: 'Ajuste de la ropa' });
  const objeto = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const propio = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
  const vacio = () => Object.fromEntries(CAMPOS.map(k => [k, 'none']));
  function normalizar(x, parcial = false) {
    const r = parcial ? {} : vacio();
    if (!objeto(x)) return r;
    for (const k of CAMPOS) if (propio(x, k)) r[k] = OPCIONES[k].some(o => o.id === x[k]) ? x[k] : 'none';
    return r;
  }
  function validar(x) {
    return objeto(x) && Object.keys(x).every(k => CAMPOS.includes(k) && OPCIONES[k].some(o => o.id === x[k]));
  }
  function combinar(comun, individual) { return { ...normalizar(comun), ...normalizar(individual, true) }; }
  function activo(x) { const s = normalizar(x); return CAMPOS.some(k => s[k] !== 'none'); }
  function vestuario(texto) {
    const t = typeof texto === 'string' ? texto : '';
    const m = t.match(/(?:^|\n|[.!?]\s+)(?:\*\*)?(?:Outfit|Wardrobe|Clothing|Vestuario|Ropa)(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*(?:Hair|Skin|Lighting|Background|Camera|Framing|Micro[- ]details|Avoid completely|Peinado|Piel|Fondo|Cámara|Encuadre)\s*:|$)/i);
    return (m ? m[1] : t).slice(0, 4000);
  }
  const CUELLO = new Set(['camisola-white','tank-white','crop-white','slip-dress','summer-dress','cardigan-shorts','deep-u-bodysuit','micromodal-camisole','ultrafine-jersey-top','stretch-viscose-camisole','second-skin-bodysuit','low-armhole-tank','boat-neck-tee','basic-spaghetti-camisole','fine-jersey-tee','side-slit-cotton-top','deep-armhole-casual-bodysuit','black-rib-u-neck-top','fitted-micromodal-camisole','underbust-seam-jersey-top','deep-v-jersey-halter-top','swimsuit-one']);
  const SISA = new Set(['camisola-white','tank-white','crop-white','slip-dress','summer-dress','deep-u-bodysuit','micromodal-camisole','stretch-viscose-camisole','second-skin-bodysuit','low-armhole-tank','basic-spaghetti-camisole','side-slit-cotton-top','deep-armhole-casual-bodysuit','black-rib-u-neck-top','fitted-micromodal-camisole','swimsuit-one']);
  function tipoTejido(prenda, texto = '') {
    const t = !prenda || prenda.id === 'none' ? vestuario(texto) : (prenda.instruction || '');
    if (/cors[eé]t|bon(?:ed|ing)|molded cups|structured.{0,25}cups|underwire|sports bra|denim.{0,25}(?:jacket|shirt|top|bodysuit|dress)|(?:rigid|tailored).{0,25}(?:jacket|shirt|bodice)/i.test(t)) return 'structured';
    if (/\b(?:stretch|elastic|knit|ribbed|jersey|micromodal|spandex|elastane)\b|ribbed[- ]knit/i.test(t)) return 'stretch';
    if (/\b(?:silk|satin|viscose|fluid|draped|loose)\b/i.test(t)) return 'fluid';
    return 'generic';
  }
  function compatibilidad(prenda, texto = '') {
    const original = !prenda || prenda.id === 'none';
    const t = original ? vestuario(texto) : (prenda.instruction || '');
    const estructurada = /cors[eé]t|bon(?:ed|ing)|molded cups|structured.{0,25}cups|underwire|sports bra|supportive/i.test(t);
    const desnuda = prenda?.id === 'nothing' || /completely (?:bare|naked)|without (?:any )?clothing|uncovered (?:bust|breasts)|bare breasts/i.test(t);
    const material = t.split(/(?<=[.!?])\s+/).filter(frase => !(/gloves|stockings|earrings|necklace|choker/i.test(frase) && !/bodysuit|corset|camisole|dress|shirt|\btop\b|\bbra\b/i.test(frase))).join(' ');
    const transparente = /\b(?:sheer|transparent|translucent|mesh|tulle|lace)\b|open[- ]knit|openwork|fine[- ]net/i.test(material) && !/\bopaque\b/i.test(material);
    const conocida = !!t.trim() && (!original || /bodysuit|camisole|camisola|tank top|shirt|dress|top\b|jersey|swimsuit|cors[eé]t/i.test(t));
    const opaca = conocida && !desnuda && !transparente;
    const suave = !estructurada && /camisole|camisola|tank|jersey|micromodal|viscose|silk slip|cotton|soft|supple/i.test(t);
    const tirantes = /camisole|camisola|tank top|sleeveless|shoulder straps|spaghetti straps/i.test(t) && !/strapless|sin tirantes/i.test(t);
    const cuello = opaca && !estructurada && (original ? /neckline|escote/i.test(t) && suave : CUELLO.has(prenda.id));
    const sisa = opaca && !estructurada && (original ? tirantes : SISA.has(prenda.id));
    return {
      bust: opaca, fall: opaca && suave, neckline: cuello, armhole: sisa, fit: opaca,
      reasons: {
        bust: opaca ? '' : 'Disponible con prendas opacas.',
        fall: opaca && suave ? '' : estructurada ? 'Las copas o el soporte de esta prenda mantienen su forma.' : 'Disponible con prendas suaves y sin estructura.',
        neckline: cuello ? '' : 'El corte de esta prenda mantiene su escote original.',
        armhole: sisa ? '' : 'Esta prenda no tiene una sisa compatible con el ajuste.',
        fit: opaca ? 'La tela se adapta sin abrir capas ni cambiar la cobertura.' : 'Disponible con prendas opacas.',
      },
    };
  }
  function efectivos(x, prenda, texto) {
    const s = normalizar(x), c = compatibilidad(prenda, texto);
    return Object.fromEntries(CAMPOS.map(k => [k, c[k] ? s[k] : 'none']));
  }
  function resumen(x) {
    const s = normalizar(x);
    return CAMPOS.filter(k => s[k] !== 'none').map(k => (k === 'bust' ? 'Busto' : TITULOS[k]) + ': ' + OPCIONES[k].find(o => o.id === s[k]).name).join(' · ');
  }
  function instruccion(x, prenda, texto) {
    const s = efectivos(x, prenda, texto);
    if (!activo(s)) return '';
    const notas = CAMPOS.map(k => OPCIONES[k].find(o => o.id === s[k]).instruction).filter(Boolean);
    if (s.fit !== 'none') {
      const tipo = tipoTejido(prenda, texto);
      const ajustes = {
        stretch: s.fit === 'snug' ? 'Let the elastic fabric follow the figure more closely, with moderate stretch and small realistic tension folds.' : 'Give the elastic fabric enough room to stretch naturally over the selected figure, with soft folds and comfortable ease.',
        fluid: s.fit === 'snug' ? 'Reduce excess fabric through a closer tailored fit, retaining the original fluid material and realistic soft folds.' : 'Allow the fluid fabric enough room to drape over the selected figure, with natural vertical folds rather than added strain.',
        structured: s.fit === 'snug' ? 'Use a closer tailored fit in the existing structured panels while preserving their shape, boning and support. Keep seams and closures functional without forcing rigid fabric to stretch.' : 'Size the existing structured panels to accommodate the selected figure while preserving their shape, boning and support. Retain realistic ease and functional seams and closures.',
        generic: s.fit === 'snug' ? 'Use a closer fit with realistic fabric tension consistent with the existing material.' : 'Allow enough room for the selected figure with realistic fabric ease and folds consistent with the existing material.',
      };
      notas.push(ajustes[tipo]);
      notas.push('Change garment ease only: retain the material, layers, support, closures and hem coverage. Do not open or remove outer layers or move the arms. Do not change the neckline or armholes beyond their separate selected adjustments. Do not change figure dimensions beyond the separately selected volume. The selected fit takes priority over earlier instructions to preserve the original garment fit only.');
    }
    if (s.bust !== 'none') notas.push('Resize the clothing to fit the selected figure, retaining its construction and front coverage. Do not change the neckline or armholes unless their separate adjustment is explicitly selected.');
    if (s.neckline !== 'none' || s.armhole !== 'none') notas.push('Only the selected neckline or armhole change takes priority over earlier requests to preserve that particular garment cut. Retain the material, opacity, layers and covered front panels.');
    notas.push('Apply only these selected adjustments to this adult character. They take priority over inherited instructions to preserve the corresponding figure dimensions for these selected changes only. Preserve the identity, remaining proportions, pose, hands, expression, gaze, hair, setting, lighting, camera angle and crop. Do not zoom in or reframe.');
    return notas.join(' ');
  }
  function aplicar(texto, x, prenda) {
    if (!activo(x)) return texto;
    const nota = instruccion(x, prenda, texto);
    return nota ? texto + '\n\nSelected figure and garment adjustments: ' + nota : texto;
  }
  globalThis.WpFisico = Object.freeze({ CAMPOS, OPCIONES, TITULOS, vacio, normalizar, validar, combinar, activo, compatibilidad, tipoTejido, efectivos, resumen, instruccion, aplicar });
})();
