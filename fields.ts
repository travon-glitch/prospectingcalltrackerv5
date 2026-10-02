import { $, fmtD, isoDate } from './util.js';
import { db } from '../data/persist.js';
import { supabase } from '../data/repo-supabase.js';
import type { BuiltInField, ColumnChoice, CustomField, CustomValue, CustomValues } from '../types.js';

export function defaultBuiltInFields(): BuiltInField[] {
  return [
    {key:"first",  label:"First name",     visible:true,  required:false, always:true},
    {key:"last",   label:"Last name",      visible:true,  required:false, always:true},
    {key:"phone",  label:"Phone",          visible:true,  required:false, always:true},
    {key:"email",  label:"Email",          visible:true,  required:false},
    {key:"addr",   label:"Street address", visible:true,  required:false},
    {key:"city",   label:"City",           visible:true,  required:false},
    {key:"state",  label:"State",          visible:false, required:false},
    {key:"zip",    label:"ZIP",            visible:true,  required:false},
  ];
}
export const BUILT_IN_DEFAULT_LABEL = Object.fromEntries(defaultBuiltInFields().map(f=>[f.key,f.label]));
export const builtIn = (key: string): BuiltInField => (db.settings.builtInFields||[]).find(f=>f.key===key) || {key,label:BUILT_IN_DEFAULT_LABEL[key]||key,visible:true,required:false};
export const fieldLabel = (key: string): string => builtIn(key).label;
export const fieldOn = (key: string): boolean => builtIn(key).visible !== false;

// ---------------------------------------------------------------- lead statuses
export const CF_TYPES = [["text","Text","A short line of text."],["long_text","Long text","A paragraph."],["number","Number","Whole numbers or decimals."],["money","Money","Shown as $425,000."],["date","Date","A real date."],["yes_no","Yes / No","A checkbox."],["choice","Choice list","One of the options you list."]];
export const CF_TYPE_LABEL = Object.fromEntries(CF_TYPES.map(t=>[t[0],t[1]]));
export const RESERVED_KEYS = new Set(["first_name","last_name","full_name","address","city","zip","agent_name","team_name","email","phone","notes","tags","status","list","campaign"]);
export const activeFields = (): CustomField[] => db.customFields.filter(f=>f.active).sort((a,b)=>a.order-b.order);
export const allFields = (): CustomField[] => db.customFields.slice().sort((a,b)=>a.order-b.order);
export const keyFromLabel = (l: string): string => l.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").replace(/^(\d)/,"f$1").slice(0,40);
export function keyProblem(key: string, taken: ReadonlySet<string>): string | null { if(!key) return "Give the field a name."; if(!/^[a-z][a-z0-9_]{0,38}[a-z0-9]$/.test(key)) return "Use 2\u201340 lowercase letters, numbers and underscores, starting with a letter."; if(RESERVED_KEYS.has(key)) return '"'+key+'" is already a built-in merge field. Try "my_'+key+'".'; if(taken.has(key)) return "Another field already uses that name."; return null; }
export const money = (n: CustomValue): string => "$" + Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
/** The stored value, ready to show. "" when the lead has nothing. */
export function cfDisplay(f: Pick<CustomField, 'type'>, raw: CustomValue | null | undefined): string { if(raw===null||raw===undefined||raw==="") return ""; if(f.type==="money") return money(raw); if(f.type==="number") return Number(raw).toLocaleString(); if(f.type==="date") return fmtD(String(raw)); if(f.type==="yes_no") return (raw===true||raw==="true") ? "Yes" : "No"; return String(raw); }
/** Cleans one typed/imported value, or throws a message a person can act on. */
export function cfClean(f: Pick<CustomField, 'type' | 'label' | 'choices'>, raw: unknown): CustomValue | null {
  const text = String(raw ?? "").trim(); if(!text) return null;
  if(f.type==="number"||f.type==="money"){ const n = Number(text.replace(/[$,\s]/g,"")); if(!isFinite(n)) throw new Error(f.label+' needs a number, got "'+text+'"'); return n; }
  if(f.type==="date"){ const d = new Date(text.length<=10 ? text+"T00:00" : text); if(isNaN(d as unknown as number)) throw new Error(f.label+' needs a date, got "'+text+'"'); return isoDate(d); }
  if(f.type==="yes_no"){ const v=text.toLowerCase(); if(["true","t","yes","y","1"].includes(v)) return true; if(["false","f","no","n","0"].includes(v)) return false; throw new Error(f.label+' needs Yes or No, got "'+text+'"'); }
  if(f.type==="choice"){ const hit = f.choices.find(c=>c.toLowerCase()===text.toLowerCase()); if(!hit) throw new Error(f.label+" must be one of: "+f.choices.join(", ")); return hit; }
  if(f.type==="long_text" && text.length>2000) throw new Error(f.label+" must be 2000 characters or fewer");
  if(f.type==="text" && text.length>200) throw new Error(f.label+" must be 200 characters or fewer");
  return text;
}
/** Merge values onto a lead, skipping unknown keys. Returns messages for refused cells. */
export function setCustom(lead: { custom?: CustomValues }, values: Record<string, unknown>): string[] {
  const problems: string[]=[]; lead.custom = lead.custom || {};
  for(const k of Object.keys(values)){
    const f = db.customFields.find(x=>x.key===k && x.active); if(!f) continue;
    try { const clean = cfClean(f, values[k]); if(clean===null) delete lead.custom[k]; else lead.custom[k]=clean; }
    catch(e){ problems.push((e as Error).message); }
  }
  return problems;
}
export const BUILT_IN_COLUMNS = [["phone","Phone"],["address","Address"],["city","City"],["zip","ZIP"],["email","Email"],["lists","Lists"],["campaigns","Campaigns"],["assigned","Assigned to"],["status","Status"],["attempts","Attempts"],["last_attempt","Last attempt"],["last_outcome","Last outcome"],["follow_up","Follow-up"]];
export const DEFAULT_COLUMNS = ["phone","address","lists","assigned","status","attempts","last_attempt","last_outcome","follow_up"];
export const columnChoices = (): ColumnChoice[] => [...BUILT_IN_COLUMNS.map(c=>({id:c[0],label:c[1],custom:false})), ...activeFields().map(f=>({id:f.key,label:f.label,custom:true}))];
export function resolvedColumns(): ColumnChoice[] { const all=new Map(columnChoices().map(c=>[c.id,c])); const ids = (db.settings.tableColumns&&db.settings.tableColumns.length) ? db.settings.tableColumns : DEFAULT_COLUMNS; return ids.map(id=>all.get(id)).filter(Boolean) as ColumnChoice[]; }
export function cardFieldsFor(): CustomField[] { const byKey=new Map(activeFields().map(f=>[f.key,f])); const ids = (db.settings.cardFields&&db.settings.cardFields.length) ? db.settings.cardFields : activeFields().filter(f=>f.onCard).map(f=>f.key); return ids.map(id=>byKey.get(id)).filter(Boolean) as CustomField[]; }

/**
 * Stage 5: for the Supabase backend, db.customFields and the built-in-field
 * half of db.settings come from the real custom_fields/built_in_fields/
 * org_settings tables instead of the local demo seed — everything above
 * (activeFields()/allFields()/resolvedColumns()/cardFieldsFor()/builtIn()/
 * fieldLabel()/...) is unchanged, since it always just reads db.customFields
 * / db.settings. Called once at session start (data/repo-supabase.js), same
 * pattern as core/permissions.js's loadRolesAndPermissions() in Stage 4. A
 * no-op on the local backend or with nobody signed in.
 */
export async function loadFieldConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const orgId = memberRow.org_id;

  const [{ data: cfRows, error: cfErr }, { data: bifRows, error: bifErr }, { data: settingsRow, error: setErr }] = await Promise.all([
    supabase.from('custom_fields').select('id,key,label,type,choices,hint,in_table,on_card,active,order').eq('org_id', orgId),
    supabase.from('built_in_fields').select('key,label,visible,required,always').eq('org_id', orgId),
    supabase.from('org_settings').select('table_columns,card_fields,import_cfg,team_name,agent_name,pts_call,pts_text,pts_door,pts_conv,pts_appt,weekly_goal,working_days').eq('org_id', orgId).maybeSingle(),
  ]);
  if(!cfErr && cfRows){
    db.customFields = cfRows.map(r => ({
      id:r.id, key:r.key, label:r.label, type:r.type, choices:r.choices||[], hint:r.hint||"",
      inTable:r.in_table, onCard:r.on_card, active:r.active, order:r.order,
    }));
  }
  if(!bifErr && bifRows && bifRows.length){
    // built_in_fields carries only the fields a team has customized away
    // from the defaults; anything not in this table keeps its shipped
    // default, exactly like builtIn()'s own fallback for an unmatched key.
    const byKey = new Map(bifRows.map(r=>[r.key, r]));
    db.settings.builtInFields = defaultBuiltInFields().map(d => {
      const r = byKey.get(d.key);
      return r ? { key:d.key, label:r.label, visible:r.visible, required:r.required, always:d.always } : d;
    });
  }
  if(!setErr && settingsRow){
    db.settings.tableColumns = settingsRow.table_columns || [];
    db.settings.cardFields = settingsRow.card_fields || [];
    // Stage 9: Settings → Import's whole tab as one jsonb blob (same shape
    // the local seed already stores it as) — merged onto the shipped
    // defaults rather than replacing them outright, so a value the org's
    // row predates (added to the demo after their org_settings row was
    // last saved) still falls back sanely instead of being `undefined`.
    if(settingsRow.import_cfg) Object.assign(db.settings.importCfg, settingsRow.import_cfg);
    // Stage 13: Settings → Team & permissions / Scoring & goals — the rest
    // of org_settings' columns, same "merge onto the shipped default"
    // treatment as import_cfg above, so a row saved before a column existed
    // still falls back to the seed's own default instead of going blank.
    if(settingsRow.team_name != null) db.settings.teamName = settingsRow.team_name;
    if(settingsRow.agent_name != null) db.settings.agentName = settingsRow.agent_name;
    if(settingsRow.pts_call != null) db.settings.ptsCall = settingsRow.pts_call;
    if(settingsRow.pts_text != null) db.settings.ptsText = settingsRow.pts_text;
    if(settingsRow.pts_door != null) db.settings.ptsDoor = settingsRow.pts_door;
    if(settingsRow.pts_conv != null) db.settings.ptsConv = settingsRow.pts_conv;
    if(settingsRow.pts_appt != null) db.settings.ptsAppt = settingsRow.pts_appt;
    if(settingsRow.weekly_goal != null) db.settings.weeklyGoal = settingsRow.weekly_goal;
    if(settingsRow.working_days) db.settings.workingDays = settingsRow.working_days;
  }
}

// ---------------------------------------------------------------- state & routing
