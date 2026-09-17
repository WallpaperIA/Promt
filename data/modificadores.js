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
  { id:'bikini-white',   tier:'premium', icon:'🤍', name:'Bikini Blanco',      desc:'Triangle top + bottom', instruction:'Replace her clothing with a minimal white triangle bikini top with thin tie strings and matching white bikini bottoms, both slightly wet and clinging naturally.' },
  { id:'bikini-black',   tier:'premium', icon:'🖤', name:'Bikini Negro',       desc:'Minimal negro', instruction:'Replace her clothing with a minimal black triangle bikini top with thin tie strings and matching black bikini bottoms.' },
  { id:'bralette-white', tier:'premium', icon:'🩱', name:'Bralette Blanco',    desc:'Simple white bralette', instruction:'Replace her clothing with a simple minimal white bralette with thin straps, the only coverage above her waist.' },
  { id:'heart-bodysuit', tier:'premium', icon:'💛', name:'Bodysuit Corazón',   desc:'Heart cutout bodysuit', instruction:'Replace her clothing with a fitted bodysuit featuring a large elegant heart-shaped cutout centered on the chest, the fabric stretching naturally across her figure.' },
  { id:'bodysuit-black', tier:'premium', icon:'⚫', name:'Bodysuit Strappy',   desc:'Black strappy bodysuit', instruction:'Replace her clothing with a minimal black strappy bodysuit — thin black straps crossing her bare back, the minimal coverage revealing her natural figure.' },
  { id:'lace-white',     tier:'full',    icon:'🌸', name:'Lace Blanco',        desc:'White lace lingerie set', instruction:'Replace her clothing with a matching white lace lingerie set — a white lace underwired bra with delicate floral lace pattern and matching white lace bikini panties.' },
  { id:'lace-red',       tier:'full',    icon:'❤️', name:'Lace Rojo',          desc:'Red lace lingerie set', instruction:'Replace her clothing with a matching red lace lingerie set — a delicate red lace triangle bralette with thin adjustable straps and matching red lace micro bikini bottoms with small satin tie-bows.' },
  { id:'lace-black',     tier:'full',    icon:'🖤', name:'Lace Negro',         desc:'Black lace lingerie set', instruction:'Replace her clothing with a matching black lace lingerie set — a delicate black lace underwired bra and matching black lace panties.' },
  { id:'sheer-camisola', tier:'full',    icon:'🫧', name:'Camisola Sheer',     desc:'Transparente', instruction:'Replace her clothing with a delicate sheer chiffon camisole in soft pale ice blue or white, the transparent sheer fabric draping naturally against her figure.' },
  { id:'blazer-black',   tier:'full',    icon:'🧥', name:'Blazer Negro',       desc:'Solo blazer, sin nada abajo', instruction:'Replace her clothing with a large oversized black blazer worn with nothing underneath, held closed by both hands, the only garment.' },
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
];
