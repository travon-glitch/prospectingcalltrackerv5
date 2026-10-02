import { opts } from '../core/dialog.js';
import { can } from '../core/permissions.js';
import { BACKEND, memberName } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, esc, fmtDT, toast } from '../core/util.js';
import { db } from '../data/persist.js';
import { listAuditLog } from '../data/repo-supabase.js';
import { badge } from '../features/activity.js';
import { draw } from '../main.js';
import type { AuditEntry } from '../types.js';

// Stage 13, supabase backend: db.audit is session-only (core/session.js's
// audit() still unshifts a local-only row per action for instant feedback,
// same as always), so #audit reads the real audit_log table instead — the
// org's 200 most recent rows, unfiltered (same one fetch either way, since
// audit_log has no RLS to lean on for per-table scoping), then filtered/
// capped client-side by the exact same expression the local backend
// already uses below. Same "cache once, kick off a fetch on a miss, draw()
// once it lands" shape stats.js's cached() (and every other supabase-
// backend read here) already follows.
let auditCache: { loaded: boolean; rows: AuditEntry[] } = { loaded:false, rows:[] };
function supabaseAuditRows(){
  if(!auditCache.loaded){
    auditCache = { loaded:true, rows: auditCache.rows };
    listAuditLog().then(rows => { auditCache = { loaded:true, rows }; draw(); }).catch(() => { toast("Couldn't load the audit log"); });
  }
  return auditCache.rows;
}

V.audit = () => {
  if(!can("viewAudit")) return '<div class="card empty">The audit log is turned off for your role.</div>';
  const all = BACKEND==="supabase" ? supabaseAuditRows() : db.audit;
  const rows = all.filter(a=>!state.auditFilter || a.table===state.auditFilter).slice(0, 200);
  return `<div class="page-head"><div><a href="#settings" onclick="go('settings');return false">‹ Settings</a><h2>Audit log</h2><p>${all.length} entries · who changed what, and when</p></div><div class="actions"><select style="width:auto" onchange="state.auditFilter=this.value;draw()">${opts([...new Set(all.map(a=>a.table))].map(t=>[t,t]),state.auditFilter,"All tables")}</select></div></div>
  <div class="card flush"><div class="tbl"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Detail</th></tr></thead><tbody>${rows.map(a=>`<tr><td class="small">${fmtDT(a.at)}</td><td>${esc(memberName(a.userId))}</td><td><span class="badge">${esc(a.action)}</span></td><td class="small">${esc(a.table)}</td><td>${esc(a.detail)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Nothing logged yet.</td></tr>'}</tbody></table></div></div>`;
};
