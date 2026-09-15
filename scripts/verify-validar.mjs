#!/usr/bin/env node
/**
 * Comprueba las verificaciones que decide si una categoría puede publicarse.
 *
 * Uso:  node scripts/verify-validar.mjs
 */
import { validarCategoria, previsualizar } from '../api/_validar.js';

let fallos = 0;
const ok = (cond, msg) => {
  if (!cond) { fallos++; console.error('  ✗ ' + msg); }
  else console.log('  ✓ ' + msg);
};

/** Una categoría válida, como base para ir rompiéndola. */
const base = () => ({
  id: 'ventana-tarde',
  name: 'Ventana · Tarde',
  sub: 'Luz natural · Sentada junto a la ventana',
  tier: 'casual',
  prompts: {
    prompt: 'Editorial photograph of __N__ sitting by a large window in the late afternoon. Soft directional light across her face, __N_HAIR__ catching the warm tones. Natural skin texture with visible pores and fine detail. Shot on 85mm, shallow depth of field, muted palette.',
    duoPrompt: 'Editorial photograph of __N1__ and __N2__ sitting together by a large window in the late afternoon. Soft directional light across both faces, natural skin texture with visible pores. Shot on 85mm, shallow depth of field, muted palette throughout the frame.',
  },
});

const tieneError = (r, campo) => r.errores.some((e) => e.campo === campo);

console.log('\n════ CATEGORÍA VÁLIDA ════');
{
  const r = validarCategoria(base());
  ok(r.ok, 'una categoría bien formada pasa');
  ok(r.errores.length === 0, 'sin errores');
}

console.log('\n════ IDENTIFICADOR ════');
{
  ok(!validarCategoria({ ...base(), id: '' }).ok, 'rechaza id vacío');
  ok(tieneError(validarCategoria({ ...base(), id: 'Con Mayúsculas' }), 'id'), 'rechaza mayúsculas y espacios');
  ok(tieneError(validarCategoria({ ...base(), id: 'guion_bajo' }), 'id'), 'rechaza guion bajo');
  ok(tieneError(validarCategoria({ ...base(), id: '-empieza-mal' }), 'id'), 'rechaza guion al inicio');
  ok(validarCategoria({ ...base(), id: 'valido-123' }).ok, 'acepta minúsculas, números y guiones');
  ok(tieneError(validarCategoria(base(), ['ventana-tarde']), 'id'), 'detecta id repetido');
}

console.log('\n════ TIER Y TEXTOS ════');
{
  ok(tieneError(validarCategoria({ ...base(), tier: 'inventado' }), 'tier'), 'rechaza tier inexistente');
  ok(tieneError(validarCategoria({ ...base(), name: '' }), 'name'), 'exige nombre');
  const sinSub = validarCategoria({ ...base(), sub: '' });
  ok(sinSub.ok, 'sin subtítulo se puede publicar');
  ok(sinSub.avisos.some((a) => a.campo === 'sub'), 'pero avisa que falta');
}

console.log('\n════ CENTINELAS ════');
{
  const c = base();
  c.prompts.prompt = c.prompts.prompt.replace('__N__', '${n}');
  ok(tieneError(validarCategoria(c), 'prompts.prompt'), 'detecta ${n} sin convertir');

  const d = base();
  d.prompts.prompt = d.prompts.prompt.replace('__N__', '__NOMBRE__');
  ok(tieneError(validarCategoria(d), 'prompts.prompt'), 'detecta centinela inventado');

  const e = base();
  e.prompts.prompt = e.prompts.prompt.replace('__N__', '__N2__');
  ok(tieneError(validarCategoria(e), 'prompts.prompt'), 'detecta __N2__ en la variante de un solo nombre');

  const f = base();
  f.prompts.duoPrompt = f.prompts.duoPrompt.replace('__N2__', 'ella');
  ok(tieneError(validarCategoria(f), 'prompts.duoPrompt'), 'detecta que falta __N2__ en dúo');

  const g = base();
  g.prompts.duoPrompt = g.prompts.duoPrompt.replace('__N1__', '__N__');
  ok(tieneError(validarCategoria(g), 'prompts.duoPrompt'), 'detecta __N__ en una variante de dos nombres');
}

console.log('\n════ VARIANTES ════');
{
  const a = base();
  delete a.prompts.prompt;
  ok(tieneError(validarCategoria(a), 'prompts.prompt'), 'exige la variante Solo');

  const b = base();
  b.prompts.prompt2 = b.prompts.prompt;
  delete b.prompts.prompt;
  ok(!validarCategoria(b).ok, 'rechaza tener v2 sin v1');

  const c = base();
  c.prompts.trioPrompt = 'Photo of __N1__, __N2__ and __N3__ together by the window in soft afternoon light, natural skin texture visible across all three faces, shot on 85mm with a shallow depth of field and a muted palette.';
  delete c.prompts.duoPrompt;
  const r = validarCategoria(c);
  ok(r.ok, 'trío sin dúo se puede publicar');
  ok(r.avisos.some((a) => a.campo === 'prompts.duoPrompt'), 'pero avisa que suele ser un olvido');

  const d = base();
  d.prompts.inventado = 'texto';
  ok(tieneError(validarCategoria(d), 'prompts'), 'rechaza una variante desconocida');
}

console.log('\n════ LARGOS ════');
{
  const corto = base();
  corto.prompts.prompt = 'Foto de __N__.';
  ok(validarCategoria(corto).avisos.length > 0, 'avisa si el prompt es muy corto');

  const largo = base();
  largo.prompts.prompt = 'Photo of __N__. ' + 'x'.repeat(13000);
  ok(!validarCategoria(largo).ok, 'rechaza un prompt desmedido');
}

console.log('\n════ RENDERIZADO ════');
{
  const salida = previsualizar('Retrato de __N__ con __N_HAIR__.', ['Ana Sofía']);
  ok(salida.includes('Ana Sofía'), 'reemplaza el nombre');
  ok(!salida.includes('__N'), 'no deja centinelas sueltos');

  const duo = previsualizar('__N1__ y __N2__ juntas.', ["Mia-Rose O'Hara", 'Zoé $1']);
  ok(duo.includes("Mia-Rose O'Hara") && duo.includes('Zoé $1'), 'soporta apóstrofes y $1 sin romperse');
}

console.log(
  fallos ? `\n✗ ${fallos} comprobaciones fallaron\n` : '\n✓ todas las comprobaciones pasaron\n'
);
process.exit(fallos ? 1 : 0);
