// Modificadores que se aplican ENCIMA de cualquier prompt.
//
// Vivían al final de data/prompts.js, que está gitignoreado por contener los
// 1188 prompts. Estas cuatro listas no tienen ninguno: se publican enteras y
// tal cual dentro de data/catalog.js, así que ya son públicas. Estaban en el
// archivo equivocado, y eso obligaba a editar a mano 1,19 MB para agregar una
// prenda. Acá se versionan como cualquier otro cambio.
//
// Ya no llevan icono: eran emoji, y cada uno traía sus colores fijos a una
// interfaz que sigue un tema. La interfaz usa el sprite SVG de index.html.
//
//   STYLES   reemplazan la apertura del prompt (prefix)
//   OUTFITS  agregan una nota de vestuario al final (instruction)
//   HAIRSTYLES  agregan una nota de peinado al final (instruction). El color
//            del pelo lo sigue poniendo el personaje (__N_HAIR__): esto sólo
//            cambia cómo está peinado. Son para todos los planes.
//   FORMATS  cambian la línea de resolución (suffix)
//   DETAILS  suman detalles al final; el campo group arma las secciones solo
//
// Las copias que hayan quedado en data/prompts.js se ignoran: build-catalog
// lee cada archivo en su propio contexto y toma los modificadores de acá.

// El catálogo anterior declara estos mismos nombres. Este contexto separado
// permite cargar la fuente pública sin chocar ni adelantar el sello del catálogo.
(function(){
const STYLES = [
  { id:'playboy',   tier:'free',    name:'Playboy Editorial', desc:'El clásico',          prefix:'Elegant Playboy style editorial portrait' },
  { id:'candid',    tier:'free',    name:'Candid Natural',    desc:'Casual íntimo',       prefix:'Elegant Playboy style candid editorial portrait' },
  { id:'studio',    tier:'free',    name:'Studio Fashion',    desc:'Estudio profesional', prefix:'Ultra-photorealistic studio fashion portrait' },
  { id:'mirror',    tier:'premium', name:'Mirror Selfie',     desc:'Selfie espejo',       prefix:'Elegant Playboy style candid mirror selfie editorial portrait' },
  { id:'noir',      tier:'premium', name:'Film Noir',         desc:'Cinematográfico',     prefix:'Elegant Playboy style film noir editorial portrait' },
  { id:'hollywood', tier:'premium', name:'Vintage Hollywood', desc:'Old glamour',         prefix:'Elegant Playboy style vintage Hollywood glamour editorial portrait' },
  { id:'cinematic', tier:'premium', name:'Cinematic Fashion', desc:'Ultra fotorrealista', prefix:'Ultra photorealistic cinematic fashion editorial' },
  { id:'hdr',       tier:'premium', name:'8K HDR',            desc:'Máximo detalle',      prefix:'Ultra photorealistic 8K HDR image' },
  { id:'closeup',   tier:'full',    name:'Close-Up Íntimo',  desc:'Cara llena el frame', prefix:'Elegant Playboy style intimate close-up editorial portrait' },
  { id:'intimate',  tier:'full',    name:'Candid Íntimo',    desc:'Sin poses',           prefix:'Candid intimate editorial portrait' },
  { id:'anime', tier:'free', name:'Anime', desc:'Líneas limpias y sombras planas', prefix:'Hand-drawn anime illustration', medium:'illustration', instruction:'Use clean expressive linework, cel shading and mature adult facial proportions. Preserve every adult character, pose, clothing coverage and composition.' },
  { id:'anime-cinematic', tier:'premium', name:'Anime cinematográfico', desc:'Luz dramática y fondos pintados', prefix:'Cinematic anime illustration', medium:'illustration', instruction:'Use refined anime linework, layered painted backgrounds, cinematic lighting and mature adult proportions. Keep each adult character recognizable through their supplied traits without changing pose or clothing coverage.' },
  { id:'manga', tier:'premium', name:'Manga', desc:'Tinta negra y tramas', prefix:'Black-and-white manga illustration', medium:'illustration', instruction:'Use crisp black ink, controlled crosshatching and halftone screentones with mature adult proportions. Preserve the existing composition, adult characters, poses and clothing coverage.' },
  { id:'cyberpunk', tier:'premium', name:'Cyberpunk', desc:'Neón y reflejos futuristas', prefix:'Cyberpunk fashion editorial portrait', instruction:'Use cyan and magenta neon rim lights and restrained futuristic accents while keeping the person more prominent than the background. Preserve the selected outfit, pose, adult characters and scene; do not add implants or change faces.' },
  { id:'neon-noir', tier:'premium', name:'Noir de neón', desc:'Sombras profundas y acentos de color', prefix:'Neon-noir cinematic editorial portrait', instruction:'Use deep cinematic shadows, a single restrained neon accent and controlled reflective highlights. Keep the adult person as the main focus and preserve pose, clothing and framing.' },
  { id:'watercolor', tier:'premium', name:'Acuarela', desc:'Pigmentos suaves sobre papel', prefix:'Watercolor editorial illustration', medium:'illustration', instruction:'Use transparent watercolor washes, visible paper grain, soft color transitions and carefully drawn adult facial features. Keep the adult characters, pose, clothing coverage and composition intact.' },
  { id:'gouache', tier:'premium', name:'Gouache', desc:'Color opaco y pinceladas', prefix:'Gouache editorial illustration', medium:'illustration', instruction:'Use opaque layered pigment, elegant brush shapes, selective crisp edges and mature adult proportions. Preserve the scene, poses, adult characters and clothing coverage.' },
  { id:'fantasy-editorial', tier:'full', name:'Fantasía editorial', desc:'Ilustración con luz etérea', prefix:'Fantasy editorial illustration', medium:'illustration', instruction:'Use sophisticated painted rendering and subtle ethereal lighting, keeping adult characters and their existing poses and clothing. Keep fantasy accents secondary to the person; do not add creatures, weapons or a new scene.' },
  { id:'render-3d', tier:'full', name:'Ilustración 3D', desc:'Materiales suaves y formas estilizadas', prefix:'Stylized 3D editorial illustration', medium:'illustration', instruction:'Use polished stylized 3D forms, soft studio illumination, tactile materials and mature adult proportions. Preserve each adult character, pose, clothing coverage and framing; avoid toy-like or childlike features.' },
  { id:'retro-future', tier:'full', name:'Retrofuturista', desc:'Cromo y paleta de los ochenta', prefix:'Retrofuturist cinematic editorial portrait', instruction:'Use restrained chrome reflections, a vintage futuristic color palette and elegant geometric light accents. Preserve adult identities, selected clothing, poses and framing; keep the person above the setting.' },
];

// ── Outfits ───────────────────────────────────────────────
// `revela:true` marca las prendas que dejan ver el cuerpo (bikinis, lencería,
// bodysuits, sábana, sin ropa). Con un estilo de ilustración no se ofrecen:
// anime y desnudez juntos es justo lo que termina pareciendo de menores.
const OUTFITS = [
  { id:'none',           tier:'free',    name:'Original',           desc:'Sin cambio de prenda', instruction:null },
  { id:'camisola-white', tier:'free',    name:'Camisola Blanca',    desc:'Loose white camisola', instruction:'Replace her clothing with a loose white cotton camisole with thin straps, the fabric draping naturally against her figure.' },
  { id:'tank-white',     tier:'free',    name:'Tank Top Blanco',    desc:'White ribbed tank top', instruction:'Replace her clothing with a simple fitted white ribbed cotton tank top with thin straps, the ribbed fabric tracing naturally across her figure.' },
  { id:'crop-white',     tier:'free',    name:'Crop Top Blanco',    desc:'White crop top', instruction:'Replace her clothing with a fitted white ribbed crop top with wide straps, the short hem ending above her midriff and leaving her entire bare stomach exposed.' },
  { id:'shirt-oversize', tier:'free',    name:'Camisa de Hombre',   desc:'Blanca, oversize', instruction:'Replace her clothing with an oversized white men\'s dress shirt, several sizes too large, sleeves rolled loosely and the collar slipping off one shoulder, the crisp cotton falling in soft folds around her frame.' },
  { id:'sweater-knit',   tier:'free',    name:'Suéter Tejido',      desc:'Oversize, hombro caído', instruction:'Replace her clothing with a chunky oversized knit sweater in warm cream wool, the wide neckline slipping down off one shoulder, the heavy cable texture catching the light.' },
  { id:'slip-dress',     tier:'free',    name:'Vestido de Seda',    desc:'Slip dress negro', instruction:'Replace her clothing with a black silk slip dress on thin spaghetti straps, the liquid fabric skimming her figure and pooling softly where it falls, a subtle sheen along every fold.' },
  { id:'denim-shorts',   tier:'free',    name:'Jean y Top',         desc:'Shorts de mezclilla', instruction:'Replace her clothing with high-waisted cut-off denim shorts and a simple fitted top, the raw frayed hem and worn indigo cotton reading as lived-in and casual.' },
  { id:'athletic-set',   tier:'free',    name:'Deportivo',          desc:'Top y calzas', instruction:'Replace her clothing with a matching athletic set: a fitted sports bra and high-waisted leggings in soft heather grey, the technical fabric smooth and close to the body.' },
  { id:'bikini-white',   tier:'premium', revela:true, name:'Bikini Blanco',      desc:'Triangle top + bottom', instruction:'Replace her clothing with a minimal white triangle bikini top with thin tie strings and matching white bikini bottoms, both slightly wet and clinging naturally.' },
  { id:'bikini-black',   tier:'premium', revela:true, name:'Bikini Negro',       desc:'Minimal negro', instruction:'Replace her clothing with a minimal black triangle bikini top with thin tie strings and matching black bikini bottoms.' },
  { id:'bralette-white', tier:'premium', revela:true, name:'Bralette Blanco',    desc:'Simple white bralette', instruction:'Replace her clothing with a simple minimal white bralette with thin straps, the only coverage above her waist.' },
  { id:'heart-bodysuit', tier:'premium', revela:true, name:'Bodysuit Corazón',   desc:'Heart cutout bodysuit', instruction:'Replace her clothing with a fitted bodysuit featuring a large elegant heart-shaped cutout centered on the chest, the fabric stretching naturally across her figure.' },
  { id:'bodysuit-black', tier:'premium', revela:true, name:'Bodysuit Strappy',   desc:'Black strappy bodysuit', instruction:'Replace her clothing with a minimal black strappy bodysuit — thin black straps crossing her bare back, the minimal coverage revealing her natural figure.' },
  { id:'swimsuit-one',   tier:'premium', revela:true, name:'Enterizo',           desc:'Traje de baño clásico', instruction:'Replace her clothing with a classic high-cut one-piece swimsuit in deep black, the smooth matte fabric tracing a clean unbroken line across her figure.' },
  { id:'silk-robe',      tier:'premium', revela:true, name:'Bata de Seda',       desc:'Abierta, sin atar', instruction:'Replace her clothing with a short silk robe in soft blush, left open and untied, the fluid fabric slipping loosely from her shoulders and catching the light along every fold.' },
  { id:'corset-black',   tier:'premium', revela:true, name:'Corset Negro',       desc:'Estructurado', instruction:'Replace her clothing with a structured black corset, boned satin shaping the waist, the laced back and firm panels defining her silhouette.' },
  { id:'bikini-red',     tier:'premium', revela:true, name:'Bikini Rojo',        desc:'Triángulo rojo', instruction:'Replace her clothing with a red triangle bikini with thin ties at the neck and hips, the saturated fabric contrasting sharply against her skin.' },
  { id:'lace-white',     tier:'full', revela:true,    name:'Lace Blanco',        desc:'White lace lingerie set', instruction:'Replace her clothing with a matching white lace lingerie set — a white lace underwired bra with delicate floral lace pattern and matching white lace bikini panties.' },
  { id:'lace-red',       tier:'full', revela:true,    name:'Lace Rojo',          desc:'Red lace lingerie set', instruction:'Replace her clothing with a matching red lace lingerie set — a delicate red lace triangle bralette with thin adjustable straps and matching red lace micro bikini bottoms with small satin tie-bows.' },
  { id:'lace-black',     tier:'full', revela:true,    name:'Lace Negro',         desc:'Black lace lingerie set', instruction:'Replace her clothing with a matching black lace lingerie set — a delicate black lace underwired bra and matching black lace panties.' },
  { id:'sheer-camisola', tier:'full', revela:true,    name:'Camisola Sheer',     desc:'Transparente', instruction:'Replace her clothing with a delicate sheer chiffon camisole in soft pale ice blue or white, the transparent sheer fabric draping naturally against her figure.' },
  { id:'blazer-black',   tier:'full', revela:true,    name:'Blazer Negro',       desc:'Solo blazer, sin nada abajo', instruction:'Replace her clothing with a large oversized black blazer worn with nothing underneath, held closed by both hands, the only garment.' },
  { id:'lace-emerald',   tier:'full', revela:true,    name:'Lace Esmeralda',     desc:'Encaje verde profundo', instruction:'Replace her clothing with a delicate emerald green lace lingerie set, the fine floral lace semi-sheer where it stretches, deep jewel tones against warm skin.' },
  { id:'fishnet',        tier:'full', revela:true,    name:'Red',                desc:'Medias de red', instruction:'Replace her clothing with black fishnet stockings and a minimal matching set, the open diamond weave pressing faint patterns into the skin beneath.' },
  { id:'bedsheet',       tier:'full', revela:true,    name:'Sábana',             desc:'Sólo una sábana', instruction:'Replace her clothing with nothing but a crumpled white cotton bedsheet loosely draped and held against her body, the soft creased fabric covering and revealing in equal measure.' },
  { id:'nothing',        tier:'full', revela:true,    name:'Sin Ropa',           desc:'Solo luz y piel', instruction:'Replace her clothing with nothing — she is completely bare, with only the lighting, her natural hair, and her pose providing coverage. Keep the composition tasteful and editorial.' },
  { id:'hoodie-oversize', tier:'free', name:'Buzo oversize', desc:'Algodón grueso y capucha', instruction:'Replace the clothing with an oversized heavyweight cotton hoodie and straight-leg casual trousers, with relaxed sleeves and natural fabric folds. Preserve all adult characters, poses and identities.' },
  { id:'summer-dress', tier:'free', name:'Vestido de verano', desc:'Lino liviano y largo midi', instruction:'Replace the clothing with a lightweight linen midi dress with a modest square neckline and softly gathered waist. Preserve each adult character and the original pose and framing.' },
  { id:'jeans-tee', tier:'free', name:'Jeans y remera', desc:'Denim recto y algodón blanco', instruction:'Replace the clothing with straight-leg indigo jeans and a plain white cotton crew-neck T-shirt. Preserve adult characters, body poses and all identifying traits.' },
  { id:'tailored-suit', tier:'premium', name:'Traje sastrero', desc:'Saco, pantalón y camisa', instruction:'Replace the clothing with a tailored charcoal suit, straight trousers and a fully buttoned ivory shirt. Keep the adult characters, their poses and framing intact.' },
  { id:'wool-coat', tier:'premium', name:'Tapado de lana', desc:'Largo y estructurado', instruction:'Replace the clothing with a long camel wool coat over a fine-knit top and tailored trousers, with a clean lapel and realistic fabric weight. Preserve adult characters and pose.' },
  { id:'techwear-set', tier:'premium', name:'Conjunto techwear', desc:'Capas técnicas y cierres', instruction:'Replace the clothing with a fully covered black technical jacket, fitted base layer and cargo trousers, using restrained utility seams and matte fabrics. Keep adult identities and poses; do not add weapons or armor.' },
  { id:'leather-jacket', tier:'premium', name:'Campera de cuero', desc:'Cuero negro, remera y jeans', instruction:'Replace the clothing with a black leather jacket over a plain cotton T-shirt and dark straight jeans. Show natural leather folds and restrained metal hardware while preserving adult characters and poses.' },
  { id:'pleated-dress', tier:'premium', name:'Vestido plisado', desc:'Largo midi y pliegues finos', instruction:'Replace the clothing with a fully lined navy midi dress with fine accordion pleats, short sleeves and a round neckline. Preserve adult characters, their poses and the scene.' },
  { id:'silk-blouse', tier:'premium', name:'Blusa de seda', desc:'Cuello cerrado y pantalón', instruction:'Replace the clothing with an opaque ivory silk blouse with a closed collar and tailored high-waisted trousers, emphasizing soft fabric folds. Preserve all adult characters and poses.' },
  { id:'metallic-dress', tier:'full', name:'Vestido metálico', desc:'Plata, largo midi y líneas limpias', instruction:'Replace the clothing with an opaque silver metallic midi dress with a high neckline and short sleeves, using controlled specular highlights. Preserve adult identities, pose and composition.' },
  { id:'holo-jacket', tier:'full', name:'Chaqueta holográfica', desc:'Reflejos iridiscentes sobre negro', instruction:'Replace the clothing with an iridescent technical jacket over an opaque black top and tailored black trousers. Use subtle holographic reflections without changing adult characters, poses or facial traits.' },
  { id:'modern-kimono', tier:'full', name:'Kimono contemporáneo', desc:'Cruzado, opaco y con cinturón', instruction:'Replace the clothing with a contemporary opaque kimono-inspired wrap outfit, securely belted over a fully covered inner layer, with understated woven texture. Preserve adult identities, pose and framing.' },
];

// ── Formats ───────────────────────────────────────────────
const FORMATS = [
  { id:'16-9',  name:'Wallpaper',        desc:'16:9 · Pantalla / PC',        ratio:'16:9',  suffix:'16:9 4K ultra-sharp resolution.' },
  { id:'9-16',  name:'Stories / Reels',  desc:'9:16 · Vertical / Celular',   ratio:'9:16',  suffix:'9:16 vertical 4K ultra-sharp resolution. Full vertical portrait orientation, subject centered.' },
  { id:'1-1',   name:'Square',           desc:'1:1 · Instagram / Feed',      ratio:'1:1',   suffix:'1:1 square 4K ultra-sharp resolution. Centered square composition.' },
  { id:'4-5',   name:'Portrait Feed',    desc:'4:5 · IG Portrait',           ratio:'4:5',   suffix:'4:5 portrait 4K ultra-sharp resolution. Vertical portrait crop.' },
  { id:'3-4',   name:'Retrato Clásico',  desc:'3:4 · Formato clásico',       ratio:'3:4',   suffix:'3:4 portrait 4K ultra-sharp resolution.' },
  { id:'21-9',  name:'Cinemascope',      desc:'21:9 · Ultra ancho / Cine',   ratio:'21:9',  suffix:'21:9 ultra-wide cinematic 4K resolution. Cinematic widescreen letterbox crop.' },
];


const DETAILS = [
  // Piel
  { id:'stretch-marks', name:'Estrías',        group:'Piel',       prompt:'visible stretch marks on hips and thighs, hyper-realistic skin texture' },
  { id:'cellulite',     name:'Celulitis',       group:'Piel',       prompt:'natural cellulite texture on thighs and buttocks' },
  { id:'freckles',      name:'Pecas',           group:'Piel',       prompt:'natural freckles on face and shoulders' },
  { id:'body-hair',     name:'Vello',           group:'Piel',       prompt:'natural body hair, unshaved legs and underarms' },
  { id:'pores',         name:'Piel real',       group:'Piel',       prompt:'visible skin pores, ultra-realistic skin texture, no digital retouching, no skin smoothing' },
  { id:'veins',         name:'Venas',           group:'Piel',       prompt:'subtle visible veins on hands and décolleté' },
  // Maquillaje
  { id:'red-lips',      name:'Labial rojo',     group:'Maquillaje', prompt:'bold red lipstick' },
  { id:'no-makeup',     name:'Sin maquillaje',  group:'Maquillaje', prompt:'no makeup, bare natural face, fresh skin' },
  { id:'smoky-eye',     name:'Smoky eye',       group:'Maquillaje', prompt:'dramatic smoky eye makeup, dark eyeshadow' },
  { id:'gloss',         name:'Gloss',           group:'Maquillaje', prompt:'glossy lip gloss, shiny lips' },
  // Extras
  { id:'nails-red',     name:'Uñas rojas',      group:'Extras',     prompt:'red nail polish' },
  { id:'nails-dark',    name:'Uñas negras',     group:'Extras',     prompt:'dark nail polish' },
  { id:'wet-hair',      name:'Pelo mojado',     group:'Extras',     prompt:'wet hair, damp glistening strands' },
  { id:'tan-lines',     name:'Marca de sol',    group:'Extras',     prompt:'visible bikini tan lines on skin' },
  { id:'sweat',         name:'Sudor',           group:'Extras',     prompt:'glistening sweat on skin, dewy glow' },
  // Fondo — excluyentes entre sí: dos fondos a la vez se contradicen.
  { id:'bg-blur',     name:'Difuminado',    group:'Fondo', excl:'fondo', prompt:'shallow depth of field, background melting into soft creamy bokeh, the subject sharply separated from it' },
  { id:'bg-dark',     name:'Oscuro',        group:'Fondo', excl:'fondo', prompt:'plain dark backdrop, deep shadow behind the subject for maximum contrast' },
  { id:'bg-clean',    name:'Limpio',        group:'Fondo', excl:'fondo', prompt:'plain smooth wall behind the subject, uncluttered, nothing competing for attention' },
  { id:'bg-white',    name:'Blanco',        group:'Fondo', excl:'fondo', prompt:'seamless white studio backdrop, bright and evenly lit' },
  { id:'bg-bokeh',    name:'Luces bokeh',   group:'Fondo', excl:'fondo', prompt:'distant city lights behind the subject dissolved into round glowing bokeh' },
  { id:'bg-haze',     name:'Neblina',       group:'Fondo', excl:'fondo', prompt:'soft atmospheric haze behind the subject, light catching the air' },
  { id:'bg-nature',   name:'Naturaleza',    group:'Fondo', excl:'fondo', prompt:'blurred green foliage behind the subject, natural outdoor depth' },
  // Luz — también excluyentes: definen de dónde y cómo viene la luz.
  { id:'li-window',   name:'De ventana',    group:'Luz',   excl:'luz',   prompt:'soft directional daylight from a nearby window, gentle falloff across the body' },
  { id:'li-golden',   name:'Hora dorada',   group:'Luz',   excl:'luz',   prompt:'warm golden hour sunlight, long soft shadows, amber tones' },
  { id:'li-rim',      name:'Contraluz',     group:'Luz',   excl:'luz',   prompt:'rim light tracing the edge of the body, separating the silhouette from the background' },
  { id:'li-hard',     name:'Luz dura',      group:'Luz',   excl:'luz',   prompt:'hard directional light, crisp defined shadows, high contrast' },
  { id:'li-lowkey',   name:'Clave baja',    group:'Luz',   excl:'luz',   prompt:'low-key lighting, most of the frame falling into shadow, only key areas lit' },
  { id:'li-neon',     name:'Neón',          group:'Luz',   excl:'luz',   prompt:'colored neon lighting, magenta and cyan reflections on the skin' },
  { id:'li-candle',   name:'Velas',         group:'Luz',   excl:'luz',   prompt:'warm candlelight, flickering soft glow, deep warm shadows' },
  { id:'li-blinds',   name:'Persianas',     group:'Luz',   excl:'luz',   prompt:'striped shadows from venetian blinds falling across the body' },
  // Cámara — el lente. Uno solo: son ópticas distintas.
  { id:'cam-85',      name:'Retrato 85mm',  group:'Cámara', excl:'lente', prompt:'shot on an 85mm portrait lens, compressed perspective, flattering proportions' },
  { id:'cam-wide',    name:'Gran angular',  group:'Cámara', excl:'lente', prompt:'wide angle lens, expansive dramatic perspective' },
  { id:'cam-film',    name:'Film 35mm',     group:'Cámara', excl:'lente', prompt:'shot on 35mm film, visible grain, natural analog color rendition' },
  // Encuadre — dónde se corta y desde qué altura.
  { id:'fr-full',     name:'Cuerpo entero', group:'Encuadre', excl:'encuadre', prompt:'full body framing, head to feet within the frame' },
  { id:'fr-medium',   name:'Plano medio',   group:'Encuadre', excl:'encuadre', prompt:'medium shot, framed from the waist up' },
  { id:'fr-high',     name:'Cenital',       group:'Encuadre', excl:'encuadre', prompt:'camera above eye level looking down at the subject' },
  { id:'fr-low',      name:'Contrapicado',  group:'Encuadre', excl:'encuadre', prompt:'camera below eye level looking up at the subject' },
];

// ── Peinados ──────────────────────────────────────────────
// Ningún peinado puede sonar aniñado ("colitas", "juvenil"): el catálogo
// tiene escenas sensuales y todo tiene que leerse adulto.
const HAIRSTYLES = [
  { id:'none',        tier:'free', name:'Original',              desc:'El de la escena',          instruction:null },
  { id:'coleta-alta', tier:'free', name:'Coleta alta',           desc:'Alta y tirante',           instruction:'Restyle her hair into a high, tight ponytail at the crown, smooth along the scalp, the length swinging freely behind her shoulders.' },
  { id:'mono-suelto', tier:'free', name:'Moño desordenado',      desc:'Con mechones sueltos',     instruction:'Restyle her hair into a loose, messy bun on top of her head, with soft strands escaping around her face and the nape of her neck.' },
  { id:'trenza',      tier:'free', name:'Trenza sobre el hombro',desc:'Larga y floja',            instruction:'Restyle her hair into a long, loose three-strand braid falling over one shoulder, a few wisps pulled free at the temples.' },
  { id:'mojado',      tier:'free', name:'Mojado hacia atrás',    desc:'Peinado con los dedos',    instruction:'Restyle her hair slicked straight back as if wet, combed through with the fingers, glossy and close to the head, the ends darker and separated into damp strands.' },
  { id:'ondas-playa', tier:'free', name:'Ondas de playa',        desc:'Sueltas y despeinadas',    instruction:'Restyle her hair into loose, tousled beach waves, airy and uneven, with a slightly matte texture as if dried by sea air.' },
  { id:'liso-raya',   tier:'free', name:'Liso con raya al medio',desc:'Lacio y prolijo',          instruction:'Restyle her hair perfectly straight and sleek with a sharp center part, falling flat and smooth past her shoulders.' },
  { id:'semi-recogido',tier:'free',name:'Semi-recogido',         desc:'Con flequillo cortina',    instruction:'Restyle her hair half-up, the top section loosely tied back, with soft curtain bangs parted in the middle framing her face.' },
  { id:'dos-monos',   tier:'free', name:'Dos moños altos',       desc:'Simétricos, con mechones', instruction:'Restyle her hair into two small, neat buns high on either side of the crown, with a few loose strands framing her face.' },
  { id:'bob', tier:'free', name:'Bob recto', desc:'Corte a la altura de la mandíbula', instruction:'Restyle the hair into a precise jaw-length bob with a clean straight edge. Preserve each adult character and their supplied natural hair color.' },
  { id:'pixie', tier:'free', name:'Pixie con textura', desc:'Corto y con volumen arriba', instruction:'Restyle the hair into a textured pixie cut with softly tapered sides and controlled volume on top. Preserve adult identities and each natural hair color.' },
  { id:'coleta-baja', tier:'free', name:'Coleta baja', desc:'Pulida y atada en la nuca', instruction:'Restyle the hair into a smooth low ponytail tied at the nape, with a soft natural part. Preserve each adult character and their natural hair color.' },
  { id:'trenzas-boxeador', tier:'free', name:'Trenzas dobles', desc:'Dos trenzas prolijas hacia atrás', instruction:'Restyle the hair into two tidy braids running back along the scalp and continuing behind the shoulders. Preserve all adult characters and their natural hair colors.' },
  { id:'trenza-corona', tier:'free', name:'Trenza corona', desc:'Recogido trenzado alrededor de la cabeza', instruction:'Restyle the hair into a loose braided crown encircling the head, with a few fine wisps at the temples. Preserve each adult identity and their natural hair color.' },
  { id:'ondas-retro', tier:'free', name:'Ondas retro', desc:'Ondas definidas y raya al costado', instruction:'Restyle the hair into soft sculpted vintage waves with a deep side part and a polished finish. Preserve adult identities and each natural hair color.' },
  { id:'rulos-naturales', tier:'free', name:'Rulos naturales', desc:'Rizos definidos y volumen suave', instruction:'Restyle the hair into defined natural curls with soft balanced volume, maintaining believable strand texture. Preserve the adult characters and each natural hair color.' },
  { id:'mono-bajo', tier:'free', name:'Moño bajo', desc:'Recogido prolijo en la nuca', instruction:'Restyle the hair into an elegant low bun at the nape with a clean part and a few natural flyaways. Preserve adult identities and each natural hair color.' },
  { id:'flequillo-recto', tier:'free', name:'Flequillo recto', desc:'Liso con flequillo sobre las cejas', instruction:'Restyle the hair into sleek straight lengths with an even fringe ending just above the eyebrows. Preserve adult facial proportions, identities and natural hair colors.' },
  { id:'shag', tier:'free', name:'Shag en capas', desc:'Capas livianas y puntas sueltas', instruction:'Restyle the hair into airy layered shag lengths with light face-framing pieces and softly tousled ends. Preserve adult identities and each natural hair color.' },
];

const listas={STYLES,OUTFITS,HAIRSTYLES,FORMATS,DETAILS};
if(typeof document!=='undefined')globalThis.WP_MODIFICADORES=listas;
// build-catalog y el validador de combinaciones leen los mismos nombres en
// sus contextos VM aislados; el navegador conserva los del catálogo anterior.
else Object.assign(globalThis,listas);
})();
