import { state } from './state.js';
import { $ } from './util.js';
import { draw } from '../main.js';

export function go(view: string, id?: number | null): void {
  // Opening a lead never drops you out of prospecting: the call bar, the queue
  // and the log form come with you, whichever screen you opened it from.
  if(view==="lead"){ state.callMode=true; if(state.view!=="lead") state.backTo=state.view; }
  else { state.callMode=false; state.backTo=null; }
  state.view=view; state.id=id ?? null; state.actOutcome=null; location.hash = view + (id ? "/"+id : ""); draw(); window.scrollTo(0,0); }
/** Opening a lead from the queue or a list keeps call mode: full detail, still calling, still Next. */
export function openInCallMode(id: number, listId?: number | string): void { if(listId!==undefined) state.queueList=String(listId); state.callMode=true; if(state.view!=="lead") state.backTo=state.view; state.view="lead"; state.id=id; state.actOutcome=null; location.hash="lead/"+id; draw(); window.scrollTo(0,0); }
// queue()/callQueue()/queueGo()/queueSkipToUnworked() moved to ./queue.js in
// Stage 7 (both backends need them, and the supabase one needs its own
// fetch/cache alongside them); every former importer here now imports them
// from there directly instead.
window.addEventListener("hashchange", ()=>{ const [v,id]=location.hash.slice(1).split("/"); if(v && (v!==state.view || (id?+id:null)!==state.id)){ if(v==="lead"){ if(state.view!=="lead") state.backTo=state.view; state.callMode=true; } else { state.callMode=false; } state.view=v; state.id=id?+id:null; draw(); } });
export function clearFilters(): void { Object.assign(state,{q:"",status:"",assigned:"",list:"",campaign:"",dnc:"any",fu:"any",outcome:"",attMin:"",attMax:"",laFrom:"",laTo:"",page:0}); draw(); }
export function setF(k: string, v: unknown): void { (state as unknown as Record<string, unknown>)[k]=v; state.page=0; draw(); }

// ---------------------------------------------------------------- dialogs
export function redrawKeepFocus(id="q"): void { const el=document.activeElement as HTMLInputElement | null; const pos=el?.selectionStart; draw(); const box=$("#"+id); if(box){ box.focus(); try{ box.setSelectionRange(pos!,pos!);}catch(e){} } }

