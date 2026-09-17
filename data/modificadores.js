// Modificadores que se aplican ENCIMA de cualquier prompt.
//
// Vivían al final de data/prompts.js, que está gitignoreado por contener los
// 1188 prompts. Estas cuatro listas no tienen ninguno: se publican enteras y
// tal cual dentro de data/catalog.js, así que ya son públicas. Estaban en el
// archivo equivocado, y eso obligaba a editar a mano 1,19 MB para agregar una
// prenda. Acá se versionan como cualquier otro cambio.
//
//   STYLES   reemplazan la apertura del prompt (prefix)
//   OUTFITS  agregan una nota de vestuario al final (instruction)
//   FORMATS  cambian la línea de resolución (suffix)
//   DETAILS  suman detalles al final; el campo group arma las secciones solo
//
// Las copias que hayan quedado en data/prompts.js se ignoran: build-catalog
// lee cada archivo en su propio contexto y toma los modificadores de acá.

const STYLES = [
  { id:'playboy',   tier:'free',    icon:'🐰', name:'Playboy Editorial', desc:'El clásico',          prefix:'Elegant Playboy style editorial portrait' },
  { id:'candid',    tier:'free',    icon:'📷', name:'Candid Natural',    desc:'Casual íntimo',       prefix:'Elegant Playboy style candid editorial portrait' },
  { id:'studio',    tier:'free',    icon:'🏛️', name:'Studio Fashion',    desc:'Estudio profesional', prefix:'Ultra-photorealistic studio fashion portrait' },
  { id:'mirror',    tier:'premium', icon:'🪞', name:'Mirror Selfie',     desc:'Selfie espejo',       prefix:'Elegant Playboy style candid mirror selfie editorial portrait' },
  { id:'noir',      tier:'premium', icon:'🎬', name:'Film Noir',         desc:'Cinematográfico',     prefix:'Elegant Playboy style film noir editorial portrait' },
  { id:'hollywood', tier:'premium', icon:'⭐', name:'Vintage Hollywood', desc:'Old glamour',         prefix:'Elegant Playboy style vintage Hollywood glamour editorial portrait' },
  { id:'cinematic', tier:'premium', icon:'🎥', name:'Cinematic Fashion', desc:'Ultra fotorrealista', prefix:'Ultra photorealistic cinematic fashion editorial' },
  { id:'hdr',       tier:'premium', icon:'📸', name:'8K HDR',            desc:'Máximo detalle',      prefix:'Ultra photorealistic 8K HDR image' },
  { id:'closeup',   tier:'full',    icon:'🔍', name:'Close-Up Íntimo',  desc:'Cara llena el frame', prefix:'Elegant Playboy style intimate close-up editorial portrait' },
  { id:'intimate',  tier:'full',    icon:'🤍', name:'Candid Íntimo',    desc:'Sin poses',           prefix:'Candid intimate editorial portrait' },
];

// ── Outfits ───────────────────────────────────────────────
const OUTFITS = [
  { id:'none',           tier:'free',    icon:'✨', name:'Original',           desc:'Sin cambio de prenda', instruction:null },
  { id:'camisola-white', tier:'free',    icon:'👗', name:'Camisola Blanca',    desc:'Loose white camisola', instruction:'Replace her clothing with a loose white cotton camisole with thin straps, the fabric draping naturally against her figure.' },
  { id:'tank-white',     tier:'free',    icon:'🤍', name:'Tank Top Blanco',    desc:'White ribbed tank top', instruction:'Replace her clothing with a simple fitted white ribbed cotton tank top with thin straps, the ribbed fabric tracing naturally across her figure.' },
  { id:'crop-white',     tier:'free',    icon:'👚', name:'Crop Top Blanco',    desc:'White crop top', instruction:'Replace her clothing with a fitted white ribbed crop top with wide straps, the short hem ending above her midriff and leaving her entire bare stomach exposed.' },
  { id:'shirt-oversize', tier:'free',    icon:'👔', name:'Camisa de Hombre',   desc:'Blanca, oversize', instruction:'Replace her clothing with an oversized white men\'s dress shirt, several sizes too large, sleeves rolled loosely and the collar slipping off one shoulder, the crisp cotton falling in soft folds around her frame.' },
  { id:'sweater-knit',   tier:'free',    icon:'🧶', name:'Suéter Tejido',      desc:'Oversize, hombro caído', instruction:'Replace her clothing with a chunky oversized knit sweater in warm cream wool, the wide neckline slipping down off one shoulder, the heavy cable texture catching the light.' },
  { id:'slip-dress',     tier:'free',    icon:'🖤', name:'Vestido de Seda',    desc:'Slip dress negro', instruction:'Replace her clothing with a black silk slip dress on thin spaghetti straps, the liquid fabric skimming her figure and pooling softly where it falls, a subtle sheen along every fold.' },
  { id:'denim-shorts',   tier:'free',    icon:'👖', name:'Jean y Top',         desc:'Shorts de mezclilla', instruction:'Replace her clothing with high-waisted cut-off denim shorts and a simple fitted top, the raw frayed hem and worn indigo cotton reading as lived-in and casual.' },
  { id:'athletic-set',   tier:'free',    icon:'🏃', name:'Deportivo',          desc:'Top y calzas', instruction:'Replace her clothing with a matching athletic set: a fitted sports bra and high-waisted leggings in soft heather grey, the technical fabric smooth and close to the body.' },
  { id:'bikini-white',   tier:'premium', icon:'🤍', name:'Bikini Blanco',      desc:'Triangle top + bottom', instruction:'Replace her clothing with a minimal white triangle bikini top with thin tie strings and matching white bikini bottoms, both slightly wet and clinging naturally.' },
  { id:'bikini-black',   tier:'premium', icon:'🖤', name:'Bikini Negro',       desc:'Minimal negro', instruction:'Replace her clothing with a minimal black triangle bikini top with thin tie strings and matching black bikini bottoms.' },
  { id:'bralette-white', tier:'premium', icon:'🩱', name:'Bralette Blanco',    desc:'Simple white bralette', instruction:'Replace her clothing with a simple minimal white bralette with thin straps, the only coverage above her waist.' },
  { id:'heart-bodysuit', tier:'premium', icon:'💛', name:'Bodysuit Corazón',   desc:'Heart cutout bodysuit', instruction:'Replace her clothing with a fitted bodysuit featuring a large elegant heart-shaped cutout centered on the chest, the fabric stretching naturally across her figure.' },
  { id:'bodysuit-black', tier:'premium', icon:'⚫', name:'Bodysuit Strappy',   desc:'Black strappy bodysuit', instruction:'Replace her clothing with a minimal black strappy bodysuit — thin black straps crossing her bare back, the minimal coverage revealing her natural figure.' },
  { id:'swimsuit-one',   tier:'premium', icon:'🩱', name:'Enterizo',           desc:'Traje de baño clásico', instruction:'Replace her clothing with a classic high-cut one-piece swimsuit in deep black, the smooth matte fabric tracing a clean unbroken line across her figure.' },
  { id:'silk-robe',      tier:'premium', icon:'🌸', name:'Bata de Seda',       desc:'Abierta, sin atar', instruction:'Replace her clothing with a short silk robe in soft blush, left open and untied, the fluid fabric slipping loosely from her shoulders and catching the light along every fold.' },
  { id:'corset-black',   tier:'premium', icon:'🎀', name:'Corset Negro',       desc:'Estructurado', instruction:'Replace her clothing with a structured black corset, boned satin shaping the waist, the laced back and firm panels defining her silhouette.' },
  { id:'bikini-red',     tier:'premium', icon:'❤️', name:'Bikini Rojo',        desc:'Triángulo rojo', instruction:'Replace her clothing with a red triangle bikini with thin ties at the neck and hips, the saturated fabric contrasting sharply against her skin.' },
  { id:'lace-white',     tier:'full',    icon:'🌸', name:'Lace Blanco',        desc:'White lace lingerie set', instruction:'Replace her clothing with a matching white lace lingerie set — a white lace underwired bra with delicate floral lace pattern and matching white lace bikini panties.' },
  { id:'lace-red',       tier:'full',    icon:'❤️', name:'Lace Rojo',          desc:'Red lace lingerie set', instruction:'Replace her clothing with a matching red lace lingerie set — a delicate red lace triangle bralette with thin adjustable straps and matching red lace micro bikini bottoms with small satin tie-bows.' },
  { id:'lace-black',     tier:'full',    icon:'🖤', name:'Lace Negro',         desc:'Black lace lingerie set', instruction:'Replace her clothing with a matching black lace lingerie set — a delicate black lace underwired bra and matching black lace panties.' },
  { id:'sheer-camisola', tier:'full',    icon:'🫧', name:'Camisola Sheer',     desc:'Transparente', instruction:'Replace her clothing with a delicate sheer chiffon camisole in soft pale ice blue or white, the transparent sheer fabric draping naturally against her figure.' },
  { id:'blazer-black',   tier:'full',    icon:'🧥', name:'Blazer Negro',       desc:'Solo blazer, sin nada abajo', instruction:'Replace her clothing with a large oversized black blazer worn with nothing underneath, held closed by both hands, the only garment.' },
  { id:'lace-emerald',   tier:'full',    icon:'💚', name:'Lace Esmeralda',     desc:'Encaje verde profundo', instruction:'Replace her clothing with a delicate emerald green lace lingerie set, the fine floral lace semi-sheer where it stretches, deep jewel tones against warm skin.' },
  { id:'fishnet',        tier:'full',    icon:'🕸️', name:'Red',                desc:'Medias de red', instruction:'Replace her clothing with black fishnet stockings and a minimal matching set, the open diamond weave pressing faint patterns into the skin beneath.' },
  { id:'bedsheet',       tier:'full',    icon:'🛏️', name:'Sábana',             desc:'Sólo una sábana', instruction:'Replace her clothing with nothing but a crumpled white cotton bedsheet loosely draped and held against her body, the soft creased fabric covering and revealing in equal measure.' },
  { id:'nothing',        tier:'full',    icon:'🌊', name:'Sin Ropa',           desc:'Solo luz y piel', instruction:'Replace her clothing with nothing — she is completely bare, with only the lighting, her natural hair, and her pose providing coverage. Keep the composition tasteful and editorial.' },
];

// ── Formats ───────────────────────────────────────────────
const FORMATS = [
  { id:'16-9',  icon:'🖥️',  name:'Wallpaper',        desc:'16:9 · Pantalla / PC',        ratio:'16:9',  suffix:'16:9 4K ultra-sharp resolution.' },
  { id:'9-16',  icon:'📱',  name:'Stories / Reels',  desc:'9:16 · Vertical / Celular',   ratio:'9:16',  suffix:'9:16 vertical 4K ultra-sharp resolution. Full vertical portrait orientation, subject centered.' },
  { id:'1-1',   icon:'⬜',  name:'Square',           desc:'1:1 · Instagram / Feed',      ratio:'1:1',   suffix:'1:1 square 4K ultra-sharp resolution. Centered square composition.' },
  { id:'4-5',   icon:'📷',  name:'Portrait Feed',    desc:'4:5 · IG Portrait',           ratio:'4:5',   suffix:'4:5 portrait 4K ultra-sharp resolution. Vertical portrait crop.' },
  { id:'3-4',   icon:'🖼️',  name:'Retrato Clásico',  desc:'3:4 · Formato clásico',       ratio:'3:4',   suffix:'3:4 portrait 4K ultra-sharp resolution.' },
  { id:'21-9',  icon:'🎬',  name:'Cinemascope',      desc:'21:9 · Ultra ancho / Cine',   ratio:'21:9',  suffix:'21:9 ultra-wide cinematic 4K resolution. Cinematic widescreen letterbox crop.' },
];


const DETAILS = [
  // Piel
  { id:'stretch-marks', icon:'〰️', name:'Estrías',        group:'Piel',       prompt:'visible stretch marks on hips and thighs, hyper-realistic skin texture' },
  { id:'cellulite',     icon:'🌊', name:'Celulitis',       group:'Piel',       prompt:'natural cellulite texture on thighs and buttocks' },
  { id:'freckles',      icon:'✨', name:'Pecas',           group:'Piel',       prompt:'natural freckles on face and shoulders' },
  { id:'body-hair',     icon:'🌿', name:'Vello',           group:'Piel',       prompt:'natural body hair, unshaved legs and underarms' },
  { id:'pores',         icon:'🔬', name:'Piel real',       group:'Piel',       prompt:'visible skin pores, ultra-realistic skin texture, no digital retouching, no skin smoothing' },
  { id:'veins',         icon:'💙', name:'Venas',           group:'Piel',       prompt:'subtle visible veins on hands and décolleté' },
  // Maquillaje
  { id:'red-lips',      icon:'💋', name:'Labial rojo',     group:'Maquillaje', prompt:'bold red lipstick' },
  { id:'no-makeup',     icon:'🍃', name:'Sin maquillaje',  group:'Maquillaje', prompt:'no makeup, bare natural face, fresh skin' },
  { id:'smoky-eye',     icon:'🖤', name:'Smoky eye',       group:'Maquillaje', prompt:'dramatic smoky eye makeup, dark eyeshadow' },
  { id:'gloss',         icon:'💎', name:'Gloss',           group:'Maquillaje', prompt:'glossy lip gloss, shiny lips' },
  // Extras
  { id:'nails-red',     icon:'💅', name:'Uñas rojas',      group:'Extras',     prompt:'red nail polish' },
  { id:'nails-dark',    icon:'🖤', name:'Uñas negras',     group:'Extras',     prompt:'dark nail polish' },
  { id:'wet-hair',      icon:'💧', name:'Pelo mojado',     group:'Extras',     prompt:'wet hair, damp glistening strands' },
  { id:'tan-lines',     icon:'☀️', name:'Marca de sol',    group:'Extras',     prompt:'visible bikini tan lines on skin' },
  { id:'sweat',         icon:'💦', name:'Sudor',           group:'Extras',     prompt:'glistening sweat on skin, dewy glow' },
  // Fondo — excluyentes entre sí: dos fondos a la vez se contradicen.
  { id:'bg-blur',     icon:'🫧', name:'Difuminado',    group:'Fondo', excl:'fondo', prompt:'shallow depth of field, background melting into soft creamy bokeh, the subject sharply separated from it' },
  { id:'bg-dark',     icon:'⬛', name:'Oscuro',        group:'Fondo', excl:'fondo', prompt:'plain dark backdrop, deep shadow behind the subject for maximum contrast' },
  { id:'bg-clean',    icon:'⬜', name:'Limpio',        group:'Fondo', excl:'fondo', prompt:'plain smooth wall behind the subject, uncluttered, nothing competing for attention' },
  { id:'bg-white',    icon:'🕊️', name:'Blanco',        group:'Fondo', excl:'fondo', prompt:'seamless white studio backdrop, bright and evenly lit' },
  { id:'bg-bokeh',    icon:'🌃', name:'Luces bokeh',   group:'Fondo', excl:'fondo', prompt:'distant city lights behind the subject dissolved into round glowing bokeh' },
  { id:'bg-haze',     icon:'🌫️', name:'Neblina',       group:'Fondo', excl:'fondo', prompt:'soft atmospheric haze behind the subject, light catching the air' },
  { id:'bg-nature',   icon:'🌿', name:'Naturaleza',    group:'Fondo', excl:'fondo', prompt:'blurred green foliage behind the subject, natural outdoor depth' },
  // Luz — también excluyentes: definen de dónde y cómo viene la luz.
  { id:'li-window',   icon:'🪟', name:'De ventana',    group:'Luz',   excl:'luz',   prompt:'soft directional daylight from a nearby window, gentle falloff across the body' },
  { id:'li-golden',   icon:'🌅', name:'Hora dorada',   group:'Luz',   excl:'luz',   prompt:'warm golden hour sunlight, long soft shadows, amber tones' },
  { id:'li-rim',      icon:'🌙', name:'Contraluz',     group:'Luz',   excl:'luz',   prompt:'rim light tracing the edge of the body, separating the silhouette from the background' },
  { id:'li-hard',     icon:'☀️', name:'Luz dura',      group:'Luz',   excl:'luz',   prompt:'hard directional light, crisp defined shadows, high contrast' },
  { id:'li-lowkey',   icon:'🕯️', name:'Clave baja',    group:'Luz',   excl:'luz',   prompt:'low-key lighting, most of the frame falling into shadow, only key areas lit' },
  { id:'li-neon',     icon:'💜', name:'Neón',          group:'Luz',   excl:'luz',   prompt:'colored neon lighting, magenta and cyan reflections on the skin' },
  { id:'li-candle',   icon:'🔥', name:'Velas',         group:'Luz',   excl:'luz',   prompt:'warm candlelight, flickering soft glow, deep warm shadows' },
  { id:'li-blinds',   icon:'📐', name:'Persianas',     group:'Luz',   excl:'luz',   prompt:'striped shadows from venetian blinds falling across the body' },
  // Cámara — el lente. Uno solo: son ópticas distintas.
  { id:'cam-85',      icon:'📷', name:'Retrato 85mm',  group:'Cámara', excl:'lente', prompt:'shot on an 85mm portrait lens, compressed perspective, flattering proportions' },
  { id:'cam-wide',    icon:'🔭', name:'Gran angular',  group:'Cámara', excl:'lente', prompt:'wide angle lens, expansive dramatic perspective' },
  { id:'cam-film',    icon:'🎞️', name:'Film 35mm',     group:'Cámara', excl:'lente', prompt:'shot on 35mm film, visible grain, natural analog color rendition' },
  // Encuadre — dónde se corta y desde qué altura.
  { id:'fr-full',     icon:'🧍', name:'Cuerpo entero', group:'Encuadre', excl:'encuadre', prompt:'full body framing, head to feet within the frame' },
  { id:'fr-medium',   icon:'🖼️', name:'Plano medio',   group:'Encuadre', excl:'encuadre', prompt:'medium shot, framed from the waist up' },
  { id:'fr-high',     icon:'⬇️', name:'Cenital',       group:'Encuadre', excl:'encuadre', prompt:'camera above eye level looking down at the subject' },
  { id:'fr-low',      icon:'⬆️', name:'Contrapicado',  group:'Encuadre', excl:'encuadre', prompt:'camera below eye level looking up at the subject' },
];
