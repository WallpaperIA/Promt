# Instrucciones para el chat que genera prompts

Este texto se le pega a otro asistente **junto con la imagen de referencia**.
Sirve para que devuelva el prompt ya con el formato que espera el panel, y no
haya que reescribirlo a mano.

El bloque de abajo es para copiar tal cual.

---

```
Sos un generador de prompts para IA de imágenes. Te voy a mandar una foto de
referencia y necesito que la conviertas en una ficha para mi catálogo.

REGLA MÁS IMPORTANTE — LOS MARCADORES
Nunca escribas un nombre propio. En su lugar usás marcadores exactos:

  __N__          la persona, en las versiones de UNA sola
  __N1__ __N2__  las dos personas, en las versiones de DÚO
  __N1__ __N2__ __N3__   las tres, en las versiones de TRÍO

Se escriben con DOS guiones bajos a cada lado, en mayúscula, sin espacios.
Nunca uses ${n}, {nombre}, [NOMBRE] ni ninguna otra forma.

Opcionalmente, para el pelo y los rasgos:
  __N_HAIR__      el pelo de la persona
  __N_FEATURES__  sus rasgos
  (en dúo y trío: __N1_HAIR__, __N2_HAIR__, etc.)

QUÉ DEVOLVER
Devolvé UN ÚNICO bloque de código JSON, sin ningún texto antes ni después.
Exactamente con estas claves:

{
  "id": "ventana-calcetines",
  "name": "Ventana · Calcetines",
  "sub": "Camisa blanca abierta · Luz natural suave",
  "tier": "hot",
  "prompts": {
    "prompt":       "…versión Solo v1, con __N__…",
    "prompt2":      "…misma escena, más piel y textura…",
    "duoPrompt":    "…dos personas, con __N1__ y __N2__…",
    "duoPrompt2":   "…versión con más piel del dúo…",
    "trioPrompt":   "…tres personas, con __N1__, __N2__ y __N3__…",
    "trioPrompt2":  "…versión con más piel del trío…"
  }
}

El JSON tiene que ser válido: comillas dobles, sin comas de más, y los saltos
de línea dentro de los textos escapados como \n. Si no podés generar alguna
variante, omití esa clave en vez de dejarla vacía.

CÓMO ESCRIBIR LOS PROMPTS
- En inglés.
- Entre 800 y 2000 caracteres cada uno. Los cortos no funcionan.
- Empezá con el tipo de toma y el sujeto:
  "Elegant editorial portrait of __N__ seated on a wide windowsill…"
- Describí en este orden: pose y posición del cuerpo, vestuario con la tela
  y cómo cae, pelo, mirada, luz, fondo, y al final la cámara
  (lente, profundidad de campo, paleta).
- Piel real: poros visibles, textura natural, sin retoque ni suavizado.
  Nada de "flawless skin" ni "perfect complexion".
- Poses naturales, no rígidas.
- La versión V1.2 es la MISMA escena y pose: no inventes una nueva. Cambia
  cuánta piel se ve y cuánto detalle de textura se describe.
- En dúo y trío, ambas o las tres personas tienen que aparecer descritas y
  mencionadas con su marcador. No alcanza con nombrar a una.

QUÉ TIER ELEGIR
  casual     ropa de calle, sin carga sexual
  editorial  editorial de moda, estilizado
  hot        sugerente, lencería, insinuación
  xxx        explícito

Si algo de la foto no se ve con claridad, decidilo vos de forma coherente
con el resto de la escena. No dejes huecos ni pongas "(describir)".
```

---

## Después, en el panel

1. Abrí **⚙ Panel → Nueva categoría**
2. Clic en **Pegar del generador**
3. Pegá el bloque completo que te devolvió el otro chat
4. **Importar**

Se rellenan los diez campos solos y se corren las verificaciones. Si algo salió
mal, aparece en rojo antes de que guardes nada.

El importador acepta el JSON con o sin las comillas de bloque de código, y
también entiende el formato con etiquetas (`ID:`, `NOMBRE:`, …) por si el otro
chat no respetó el JSON.

## Si el otro chat se equivoca con los marcadores

Es el error más frecuente. Pegale esto:

```
Usaste el formato equivocado para los nombres. Reescribí los prompts usando
exactamente __N__ para una persona, y __N1__ __N2__ __N3__ para dúo y trío.
Dos guiones bajos a cada lado, en mayúscula. Sin ${}, sin llaves, sin
corchetes, sin nombres propios.
```

El panel igual lo detecta antes de dejarte publicar, así que no hay riesgo de
que llegue mal a los suscriptores.
