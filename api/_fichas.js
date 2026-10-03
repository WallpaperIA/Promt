import { createHash } from 'node:crypto';
import { applyCors } from './_cors.js';
import { bearer, resolveTier } from './_sesion.js';

export const RANGO = { casual: 0, editorial: 0, hot: 1, xxx: 2 };
export const RANGO_USUARIO = { free: 0, premium: 1, full: 2 };
const VARIANTES=['prompt','prompt2','duoPrompt','duoPrompt2','trioPrompt','trioPrompt2'];
const CAMPOS='variant, model, model_version, tested_on, evidence_path, body_hash';
export const huellaPrueba=body=>createHash('sha256').update(body).digest('hex');
const faltaTabla=e=>['42P01','PGRST205'].includes(e?.code);

/** El registro es una afirmación manual del admin ligada a un resultado real.
 * No certifica una IA ni convierte las notas internas anteriores en públicas. */
export function crearHandlerFicha(supabase, esAdmin=false){
  return async(req,res)=>{
    applyCors(req,res,esAdmin?'GET, POST, DELETE, OPTIONS':'GET, OPTIONS');
    res.setHeader('Cache-Control','private, no-store');
    if(req.method==='OPTIONS') return res.status(200).end();
    if(!(esAdmin?['GET','POST','DELETE']:['GET']).includes(req.method)) return res.status(405).json({error:'method_not_allowed'});
    try{
      const sesion=await resolveTier(supabase,bearer(req));
      if(esAdmin && !sesion.admin) return res.status(401).json({error:'no_autorizado'});
      let b=req.body||{};
      if(typeof b==='string'){try{b=JSON.parse(b);}catch{b={};}}
      if(!b || typeof b!=='object' || Array.isArray(b)) return res.status(400).json({error:'bad_request'});
      const id=req.method==='POST'?b.id:req.query?.id;
      if(typeof id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(id)) return res.status(400).json({error:'bad_request'});
      const {data:cat,error:catError}=await supabase.from('categories').select('id, tier, status').eq('id',id).maybeSingle();
      if(catError) throw catError;
      if(!cat || (!sesion.admin && cat.status!=='publicada')) return res.status(404).json({error:'not_found'});
      if(!esAdmin && !sesion.admin && (RANGO_USUARIO[sesion.tier]??0)<(RANGO[cat.tier]??2)) return res.status(403).json({error:'needs_upgrade'});
      if(req.method==='DELETE'){
        if(!VARIANTES.includes(req.query?.variant)) return res.status(400).json({error:'bad_request'});
        const {error}=await supabase.from('category_test_records').delete().eq('cat_id',id).eq('variant',req.query.variant);
        if(error) throw error; return res.status(200).json({ok:true});
      }
      const {data:bodies,error:bodyError}=await supabase.from('prompt_bodies').select('variant, body').eq('cat_id',id);
      if(bodyError) throw bodyError;
      const {data:imagenes,error:imgError}=await supabase.from('category_examples').select('ruta').eq('cat_id',id).order('orden',{ascending:true});
      if(imgError) throw imgError;
      if(req.method==='POST'){
        const texto=(t,n)=>typeof t==='string' && t.trim().length>0 && t.trim().length<=n && !/[\x00-\x1f\x7f]/.test(t);
        const fecha=typeof b.tested_on==='string' && /^\d{4}-\d{2}-\d{2}$/.test(b.tested_on)?new Date(b.tested_on+'T00:00:00Z'):null;
        if(b.confirmed!==true || !VARIANTES.includes(b.variant) || !texto(b.model,80) || !texto(b.model_version,80)
          || !fecha || !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0,10)!==b.tested_on || b.tested_on>new Date().toISOString().slice(0,10)
          || typeof b.evidence_path!=='string' || !imagenes.some(i=>i.ruta===b.evidence_path)) return res.status(400).json({error:'invalid_record'});
        const original=bodies.find(p=>p.variant===b.variant);
        if(!original?.body) return res.status(400).json({error:'missing_variant'});
        // La huella sale del servidor. Un seed o una edición posterior hace
        // que el registro deje de describir el texto actual, aunque no borre la fila.
        const registro={cat_id:id,variant:b.variant,model:b.model.trim(),model_version:b.model_version.trim(),tested_on:b.tested_on,
          evidence_path:b.evidence_path,body_hash:huellaPrueba(original.body)};
        const {error}=await supabase.from('category_test_records').upsert(registro,{onConflict:'cat_id,variant'});
        if(error) throw error; return res.status(200).json({ok:true});
      }
      const {data:registros,error}=await supabase.from('category_test_records').select(CAMPOS).eq('cat_id',id);
      if(error){ if(faltaTabla(error) && !esAdmin) return res.status(200).json({pruebas:[],estado:'no_disponible'}); throw error; }
      if(esAdmin){
        const resultados=await Promise.all(imagenes.map(async i=>{
          const {data}=await supabase.storage.from('ejemplos').createSignedUrl(i.ruta,60*30);
          return {...i,imagen:data?.signedUrl||null};
        }));
        return res.status(200).json({registros:registros.map(({body_hash,...r})=>({...r,vigente:bodies.some(p=>p.variant===r.variant&&huellaPrueba(p.body)===body_hash)
          && imagenes.some(i=>i.ruta===r.evidence_path)})),imagenes:resultados});
      }
      const pruebas=[];
      for(const r of registros){
        if(!bodies.some(p=>p.variant===r.variant&&huellaPrueba(p.body)===r.body_hash) || !imagenes.some(i=>i.ruta===r.evidence_path)) continue;
        const {data,error:firmError}=await supabase.storage.from('ejemplos').createSignedUrl(r.evidence_path,60*30);
        if(firmError) throw firmError;
        if(data?.signedUrl) pruebas.push({variant:r.variant,model:r.model,model_version:r.model_version,tested_on:r.tested_on,imagen:data.signedUrl});
      }
      return res.status(200).json({pruebas,estado:'disponible'});
    }catch(e){
      console.error('ficha de pruebas',e.code||'database_error');
      return res.status(faltaTabla(e)?503:500).json({error:faltaTabla(e)?'storage_unavailable':'server_error'});
    }
  };
}
