/**
 * Verificaciones que una categoría tiene que pasar antes de publicarse.
 *
 * Corre en el servidor (autoridad) y también en el navegador, para que el
 * panel muestre los errores mientras se escribe. Por eso no importa nada:
 * tiene que poder cargarse en los dos lados.
 *
 * Lo que se comprueba es el FORMATO. Que el prompt genere una buena imagen
 * no lo puede saber un programa: eso lo confirma la persona probándolo, y
 * queda registrado aparte.
 */

export const VARIANTES = ['prompt', 'prompt2', 'duoPrompt', 'duoPrompt2', 'trioPrompt', 'trioPrompt2'];
export const TIERS = ['casual', 'editorial', 'hot', 'xxx'];
export const ESTADOS = ['borrador', 'prueba', 'publicada'];

/** Cuántos nombres usa cada variante. */
const NOMBRES_POR_VARIANTE = { prompt: 1, prompt2: 1, duoPrompt: 2, duoPrompt2: 2, trioPrompt: 3, trioPrompt2: 3 };

const CENTINELA_RE = /__N([123]?)(_HAIR|_FEATURES)?__/g;
const LARGO_MIN = 120;

/**
 * Frases que remiten a otro texto. Cada variante se guarda y se sirve sola,
 * así que "arriba" no existe: lo que quede sin describir, no llega.
 */
const RELATIVAS = /\b(?:same (?:scene|pose|setting|outfit|lighting)[^.]{0,40}\bas above|as (?:described |shown )?above|as (?:in|per) the (?:previous|first) (?:prompt|version)|misma escena que arriba|como (?:arriba|el anterior))\b/i;
const LARGO_MAX = 12000;

/** Nombres con acentos, apóstrofe y un "$1" que rompería un replace mal escrito. */
const NOMBRES_PRUEBA = ['Ana Sofía', "Mia-Rose O'Hara", 'Zoé $1'];

const err = (campo, mensaje) => ({ nivel: 'error', campo, mensaje });
const avi = (campo, mensaje) => ({ nivel: 'aviso', campo, mensaje });

/** Reemplaza los centinelas, igual que el navegador al renderizar. */
function renderizar(tpl, nombres) {
  return String(tpl).replace(CENTINELA_RE, (_m, idx, campo) => {
    const nombre = nombres[idx ? Number(idx) - 1 : 0];
    if (nombre === undefined) return '';
    if (!campo) return nombre;
    return campo === '_HAIR' ? 'pelo castaño' : 'rasgos naturales';
  });
}

/** Los centinelas que usa un texto, agrupados. */
function centinelasDe(tpl) {
  const usados = new Set();
  let m;
  const re = new RegExp(CENTINELA_RE.source, 'g');
  while ((m = re.exec(String(tpl))) !== null) usados.add(m[0]);
  return usados;
}

function validarVariante(nombreVariante, texto, problemas) {
  const c = `prompts.${nombreVariante}`;

  if (typeof texto !== 'string' || !texto.trim()) {
    problemas.push(err(c, 'Está vacío.'));
    return;
  }

  if (texto.includes('${')) {
    problemas.push(err(c, 'Quedó un ${...} sin resolver. Los nombres van con __N__, no con ${n}.'));
  }

  // Un centinela mal escrito (__N4__, __NOMBRE__) no se reemplazaría nunca y
  // el suscriptor vería el texto crudo en su prompt.
  for (const token of texto.match(/__[A-Z0-9_]+__/g) || []) {
    if (!/^__N[123]?(_HAIR|_FEATURES)?__$/.test(token)) {
      problemas.push(err(c, `Centinela desconocido: ${token}. Válidos: __N__, __N1__, __N2__, __N3__, __N_HAIR__, __N_FEATURES__.`));
    }
  }

  const cantidad = NOMBRES_POR_VARIANTE[nombreVariante];
  const usados = centinelasDe(texto);

  if (cantidad === 1) {
    if (!usados.has('__N__') && !texto.includes('__N_')) {
      problemas.push(avi(c, 'No menciona a la persona con __N__. ¿Es una escena sin personajes?'));
    }
    for (const t of usados) {
      if (/^__N[123]/.test(t)) {
        problemas.push(err(c, `Usa ${t}, pero esta variante recibe un solo nombre: corresponde __N__.`));
      }
    }
  } else {
    for (let i = 1; i <= cantidad; i++) {
      if (!usados.has(`__N${i}__`)) {
        problemas.push(err(c, `Falta __N${i}__. Esta variante recibe ${cantidad} nombres y tiene que mencionarlos a todos.`));
      }
    }
    if (usados.has('__N__')) {
      problemas.push(err(c, 'Usa __N__, que es para una sola persona. Acá van __N1__, __N2__' + (cantidad === 3 ? ', __N3__' : '') + '.'));
    }
    for (const t of usados) {
      const m = t.match(/^__N([123])/);
      if (m && Number(m[1]) > cantidad) {
        problemas.push(err(c, `Usa ${t}, pero esta variante recibe sólo ${cantidad} nombres.`));
      }
    }
  }


  // Referencias a un texto que no existe.
  //
  // Los prompts se guardan sueltos: cada variante viaja sola al navegador. Una
  // frase como "same scene and pose as above" tenía sentido cuando la v1.2 se
  // escribía debajo de la v1, pero guardada aparte apunta a la nada y el
  // generador no tiene con qué completar la escena.
  //
  // Pasó de verdad: 34 categorías quedaron con la misma v1.2 genérica, sin
  // escena ni vestuario, porque era sólo la coletilla.
  if (RELATIVAS.test(texto)) {
    const frase = texto.match(RELATIVAS)[0];
    problemas.push(err(c, `Dice "${frase}", pero cada variante se guarda por separado: no hay ningún texto "arriba". La escena tiene que estar descrita entera acá.`));
  }

  if (texto.length < LARGO_MIN) {
    problemas.push(avi(c, `Son ${texto.length} caracteres. Parece corto para un prompt de imagen.`));
  }
  if (texto.length > LARGO_MAX) {
    problemas.push(err(c, `Son ${texto.length} caracteres, por encima del máximo de ${LARGO_MAX}. ¿Se pegó texto de más?`));
  }

  // Renderizado real con nombres difíciles: si algo rompe, rompe acá y no
  // en el navegador de un suscriptor.
  try {
    const nombres = NOMBRES_PRUEBA.slice(0, cantidad);
    const salida = renderizar(texto, nombres);
    if (/__N[123]?(_HAIR|_FEATURES)?__/.test(salida)) {
      problemas.push(err(c, 'Tras renderizar quedaron centinelas sin reemplazar.'));
    }
    for (const n of nombres) {
      if (!salida.includes(n)) {
        problemas.push(err(c, `Al renderizar no apareció el nombre "${n}".`));
      }
    }
  } catch (e) {
    problemas.push(err(c, 'Falla al renderizar: ' + e.message));
  }
}

/**
 * @param {object} cat  { id, name, sub, tier, ready, prompts:{variante:texto} }
 * @param {string[]} idsExistentes  para detectar ids repetidos
 * @returns {{ok:boolean, errores:array, avisos:array}}
 */
export function validarCategoria(cat, idsExistentes = []) {
  const problemas = [];
  const c = cat || {};

  // ── Identificador ──
  if (!c.id || !String(c.id).trim()) {
    problemas.push(err('id', 'Falta el identificador.'));
  } else {
    const id = String(c.id).trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      problemas.push(err('id', 'Sólo minúsculas, números y guiones. Ejemplo: ventana-calcetines.'));
    }
    if (id.length > 60) problemas.push(err('id', 'Máximo 60 caracteres.'));
    if (idsExistentes.includes(id)) {
      problemas.push(err('id', `Ya existe una categoría con el id "${id}".`));
    }
  }

  // ── Textos visibles ──
  if (!c.name || !String(c.name).trim()) {
    problemas.push(err('name', 'Falta el nombre.'));
  } else if (String(c.name).length > 90) {
    problemas.push(err('name', 'Máximo 90 caracteres.'));
  }

  if (!c.sub || !String(c.sub).trim()) {
    problemas.push(avi('sub', 'Sin subtítulo. Es lo que se lee debajo del nombre en la lista.'));
  } else if (String(c.sub).length > 140) {
    problemas.push(err('sub', 'Máximo 140 caracteres.'));
  }

  // ── Tier ──
  if (!TIERS.includes(c.tier)) {
    problemas.push(err('tier', `Tier inválido. Válidos: ${TIERS.join(', ')}.`));
  }

  // ── Prompts ──
  const prompts = c.prompts || {};
  const presentes = VARIANTES.filter((v) => typeof prompts[v] === 'string' && prompts[v].trim());

  if (!presentes.includes('prompt')) {
    problemas.push(err('prompts.prompt', 'La variante Solo es obligatoria: es la base de la categoría.'));
  }

  for (const v of presentes) validarVariante(v, prompts[v], problemas);

  for (const clave of Object.keys(prompts)) {
    if (!VARIANTES.includes(clave)) {
      problemas.push(err('prompts', `Variante desconocida: "${clave}".`));
    }
  }

  // Coherencia entre v1 y v2: tener la v2 sin la v1 deja el selector roto.
  for (const [base, dos] of [['prompt', 'prompt2'], ['duoPrompt', 'duoPrompt2'], ['trioPrompt', 'trioPrompt2']]) {
    if (presentes.includes(dos) && !presentes.includes(base)) {
      problemas.push(err(`prompts.${dos}`, `Hay ${dos} pero falta ${base}. El selector de versión necesita la v1.`));
    }
  }

  if (presentes.includes('trioPrompt') && !presentes.includes('duoPrompt')) {
    problemas.push(avi('prompts.duoPrompt', 'Hay Trío pero no Dúo. Es posible, pero suele ser un olvido.'));
  }

  return {
    ok: !problemas.some((p) => p.nivel === 'error'),
    errores: problemas.filter((p) => p.nivel === 'error'),
    avisos: problemas.filter((p) => p.nivel === 'aviso'),
  };
}

/** Vista previa con nombres reales, para mostrar en el panel. */
export function previsualizar(texto, nombres) {
  return renderizar(texto, nombres && nombres.length ? nombres : NOMBRES_PRUEBA);
}
