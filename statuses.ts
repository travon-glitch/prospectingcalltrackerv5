import { db } from '../data/persist.js';
import { supabase } from '../data/repo-supabase.js';
import type { Status } from '../types.js';

export function defaultStatuses(): Status[] {
  return [
    {key:"new",            label:"New",            tone:"blue",   active:true, locked:true},
    {key:"attempted",      label:"Attempted",      tone:"",       active:true, locked:true},
    {key:"contacted",      label:"Contacted",      tone:"green",  active:true, locked:true},
    {key:"appointment",    label:"Appointment",    tone:"green",  active:true, locked:true},
    {key:"do_not_call",    label:"Do Not Call",    tone:"red",    active:true, locked:true},
    {key:"do_not_contact", label:"Do Not Contact", tone:"red",    active:true, locked:true},
    {key:"closed",         label:"Closed",         tone:"",       active:true},
  ];
}
export const STATUS_TONES = [["","Grey"],["blue","Blue"],["green","Green"],["orange","Orange"],["red","Red"]];
export const statusList = (): Status[] => db.settings.statuses || defaultStatuses();
export const statusDef = (key: string): Status => statusList().find(x=>x.key===key) || {key, label:key, tone:""};

// ---------------------------------------------------------------- seed data
export const statusLabel = (key: string): string => statusDef(key).label;

/** Stage 5: db.settings.statuses from the real `statuses` table for the
 * Supabase backend — statusList()/statusDef()/statusLabel() above are
 * unchanged, they just read db.settings.statuses either way. Called at
 * session start alongside loadFieldConfig()/loadRolesAndPermissions(). */
export async function loadStatusConfig(): Promise<void> {
  if(!supabase) return;
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return;
  const { data: memberRow, error: memberErr } = await supabase
    .from('members').select('org_id').eq('auth_user_id', user.id).maybeSingle();
  if(memberErr || !memberRow) return;
  const { data: rows, error } = await supabase
    .from('statuses').select('key,label,tone,active,locked,"order"')
    .eq('org_id', memberRow.org_id).order('order');
  if(error || !rows) return;
  db.settings.statuses = rows.map(r => ({ key:r.key, label:r.label, tone:r.tone||"", active:r.active, locked:r.locked }));
}
