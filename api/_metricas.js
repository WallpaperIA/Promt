import { applyCors } from './_cors.js';
import { bearer, resolveTier } from './_sesion.js';

const EVENTOS=['probar-gratis','copiar-gratis','copiar','ver-planes','ir-a-patreon'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contador=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
// Cloud usa números; instalaciones anteriores devolvían {value}. Rechazar
// otros formatos evita convertir un error del proveedor en cero visitas.
const valor=v=>contador(v?.value??v);

export function crearHandlerMetricas(supabase,{env=process.env,fetchImpl=fetch,ahora=()=>Date.now()}={}){
  const cache=new Map(),pendientes=new Map();
  return async(req,res)=>{
    applyCors(req,res,'GET, OPTIONS');res.setHeader('Cache-Control','private, no-store');
    if(req.method==='OPTIONS')return res.status(200).end();
    if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
    try{
      const sesion=await resolveTier(supabase,bearer(req));
      if(!sesion.admin)return res.status(401).json({error:'no_autorizado'});
      const dias=req.query?.dias===undefined?7:Number(req.query.dias);
      if(![7,30].includes(dias)||Array.isArray(req.query?.dias))return res.status(400).json({error:'bad_request'});
      const id=env.UMAMI_WEBSITE_ID,key=env.UMAMI_API_KEY,region=env.UMAMI_REGION||'';
      if(!UUID.test(id||'')||!key||!['','us','eu'].includes(region))return res.status(503).json({error:'metricas_sin_configurar'});
      const guardado=cache.get(dias);
      if(guardado&&ahora()-guardado.momento<60000)return res.status(200).json(guardado.informe);
      if(!pendientes.has(dias)){
        const trabajo=(async()=>{
          const hasta=ahora(),desde=hasta-dias*86400000,control=new AbortController();
          const tiempo=setTimeout(()=>control.abort(),8000);
          try{
            // Sólo se consulta el sitio configurado y dimensiones agregadas.
            // Ninguna URL, clave, filtro o ID de visitante sale del cliente.
            const base='https://api.umami.is/v1'+(region?'/'+region:'')+'/websites/'+id;
            const qs=new URLSearchParams({startAt:String(desde),endAt:String(hasta)});
            async function traer(ruta){
              const r=await fetchImpl(base+ruta,{signal:control.signal,redirect:'error',headers:{Authorization:'Bearer '+key,Accept:'application/json'}});
              if(!r.ok)throw Object.assign(new Error('umami'),{tipo:r.status===401||r.status===403?'umami_autorizacion':r.status===429?'umami_limite':'umami_no_disponible'});
              return r.json();
            }
            const [stats,eventos]=await Promise.all([traer('/stats?'+qs),traer('/metrics?'+qs+'&type=event&limit=500')]);
            const visitas=stats?.visits===undefined?null:valor(stats.visits),paginas=valor(stats?.pageviews),visitantes=valor(stats?.visitors);
            if((stats?.visits!==undefined&&visitas===null)||paginas===null||visitantes===null||!Array.isArray(eventos)||eventos.length>=500)throw new Error('formato_umami');
            const cuentas=Object.fromEntries(EVENTOS.map(e=>[e,0]));
            for(const fila of eventos){
              if(!EVENTOS.includes(fila.x))continue;
              const n=contador(fila.y);if(n===null)throw new Error('formato_umami');
              cuentas[fila.x]+=n;if(!Number.isSafeInteger(cuentas[fila.x]))throw new Error('formato_umami');
            }
            const informe={websiteId:id,dias,desde,hasta,visitas,paginas,visitantes,eventos:cuentas,actualizado:new Date(hasta).toISOString()};
            cache.set(dias,{momento:ahora(),informe});return informe;
          }finally{clearTimeout(tiempo);}
        })();pendientes.set(dias,trabajo);
      }
      try{return res.status(200).json(await pendientes.get(dias));}
      finally{pendientes.delete(dias);}
    }catch(e){
      return res.status(e.tipo==='umami_autorizacion'||e.tipo==='umami_limite'?503:502).json({error:e.tipo||'umami_no_disponible'});
    }
  };
}
