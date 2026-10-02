import { confirmDlg } from '../core/dialog.js';
import { go } from '../core/router.js';
import { BACKEND, me, setMe } from '../core/session.js';
import { $, TODAY, download, toast } from '../core/util.js';
import { orgBackup } from './repo-supabase.js';
import { seed } from './seed.js';
import { upgradeDb } from './upgrade.js';
import type { Db, SavedState } from '../types.js';

export const SAVE_KEY = "pct-demo-v3";
export function loadSaved(): SavedState | null { try { const raw = localStorage.getItem(SAVE_KEY); if(!raw) return null; const j = JSON.parse(raw); return j && j.db && j.db.pipelines ? j : null; } catch { return null; } }
export function persist(): void { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ db, meId: me?.id ?? null, savedAt: new Date().toISOString() })); } catch { /* private mode or full */ } }
export function resetDemo(): void { confirmDlg("Reset the demo data?", "Everything you changed in this browser is thrown away and the sample data comes back.", "Reset", ()=>{ try { localStorage.removeItem(SAVE_KEY); } catch {} location.hash=""; location.reload(); }); }
export const _saved = loadSaved();
export let db: Db = upgradeDb(_saved ? _saved.db : seed());
export const nid = (): number => ++db.seq;

// ---------------------------------------------------------------- session / permissions
export function backup(): void {
  if(BACKEND==="supabase"){
    orgBackup().then(data => { download(`call-tracker-backup-${TODAY}.json`, JSON.stringify(data), "application/json"); toast("Backup downloaded"); }).catch(e=>toast(e.message));
    return;
  }
  download(`call-tracker-backup-${TODAY}.json`, JSON.stringify({version:1, savedAt:new Date().toISOString(), db}), "application/json"); toast("Backup downloaded");
}
// Stage 13: restoring a backup into a real Supabase org was judged unsafe
// to build unilaterally (see supabase/functions/org-backup's own header —
// the person operating this migration agreed) — id remapping across every
// FK-linked table and a broken Auth account for every restored member,
// with no way to do either safely from the client. The local backend's own
// restore (a straight in-memory `db=j.db` swap) is unaffected and still
// works exactly as it always has.
$("#restoreIn").addEventListener("change", async (e)=>{
  const f=(e.target as HTMLInputElement).files![0]; (e.target as HTMLInputElement).value=""; if(!f) return;
  if(BACKEND==="supabase"){ toast("Restoring a backup isn't available on this backend — export only."); return; }
  try{ const j=JSON.parse(await f.text()); if(!j.db||!j.db.leads) throw 0; db=j.db; setMe(db.members.find(m=>m.id===me?.id)||db.members[0]); toast("Backup restored"); go("dashboard"); }catch{ toast("That isn't a valid backup file"); }
});

// ================================================================ CRM Pipeline
// Qualified leads move from the prospecting lists into a visual pipeline.
// A "deal" is the CRM record for a lead: same lead, no copy — the deal points
// at the lead and everything else (calls, texts, notes, follow-ups) stays where
// it already is. One deal per lead per pipeline, so nothing is ever duplicated.

