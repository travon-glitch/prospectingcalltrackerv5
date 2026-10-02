import { can, roleName } from '../core/permissions.js';
import { go } from '../core/router.js';
import { callQueue } from '../core/queue.js';
import { BACKEND, audit, me } from '../core/session.js';
import { TITLES, state } from '../core/state.js';
import { $, esc } from '../core/util.js';
import { db } from '../data/persist.js';
import { callBtn, full, textBtn } from '../features/activity.js';
import { canAdmin } from './admin.js';

export const NAV = [["dashboard","▦","Dashboard"],["workspace","☏","Start Prospecting"],["leads","◎","Leads"],["lists","☰","Prospecting Lists"],["crm","◫","CRM Pipeline"],["followups","▣","Follow-Ups"],["campaigns","✉","Campaign Messages"],["scoreboard","♛","Weekly Scoreboard"],["reports","▥","Team Dashboard"],["imports","⇧","Imports"],["admin","♟","Admin"],["settings","⚙","Settings"]];
export function shell(content: string){
  const active = {lead:"leads",list:"lists",campaign:"campaigns",messages:"campaigns",audit:"settings",deal:"crm",crmdash:"crm"}[state.view] || state.view;
  // Audit fix: this banner describes the local backend specifically
  // (everything in-browser, no real login/shared DB) — it was rendering
  // unconditionally, which is simply false once VITE_BACKEND=supabase is
  // actually deployed, regardless of whether VITE_DEMO_LOGIN is on.
  return `${BACKEND==="local"?'<div class="banner">DEMO — everything runs in this page and is saved in this browser, so it survives a refresh. The real app adds logins, team security and a shared database.</div>':""}
  <div class="layout ${state.collapsed?"collapsed":""}"><aside class="sidebar"><div class="logo"><span class="mark">☏</span><span><b>Prospecting</b><small>Call Tracker</small></span></div><nav class="nav">${NAV.map(([v,ic,t])=>((v==="imports"&&!can("import"))||(v==="admin"&&!canAdmin()))?"":`<a href="#${v}" data-view="${v}" class="${active===v?"active":""}" onclick="go('${v}');return false" title="${t}"><span class="ic">${ic}</span><span class="t">${t}</span></a>`).join("")}</nav><div class="collapse" onclick="state.collapsed=!state.collapsed;draw()"><span class="ic">${state.collapsed?"▸":"◂"}</span><span class="t">Collapse</span></div></aside>
  <div><header class="topbar"><h1 id="title">${esc(state.view==="lead"?(db.leads.find(x=>x.id===state.id)?full(db.leads.find(x=>x.id===state.id)!):"Lead"):TITLES[state.view]||"")}</h1><button class="btn plain sm" onclick="toggleTheme()" title="Light / dark">Theme</button><span class="pill team">${esc(db.settings.teamName)}</span><button class="pill who" onclick="signOut()" title="${esc(me!.name)} — sign out">${esc(me!.name.split(" ")[0])} · ${esc(roleName(me))}</button></header><main id="main">${content}</main></div></div>
  ${callBarMobile()}
  <nav class="bottomnav">${[["dashboard","▦","Home"],["workspace","☎","Call"],["leads","≡","Leads"],["crm","◫","CRM"],["followups","◷","Follow-ups"],["settings","⚙","More"]].map(([v,ic,t])=>`<a href="#${v}" class="${active===v?"active":""}" onclick="go('${v}');return false"><span>${ic}</span>${t}</a>`).join("")}</nav>`;
}
export function toggleTheme(){ const r=document.documentElement; const dark = r.dataset.theme ? r.dataset.theme==="dark" : matchMedia("(prefers-color-scheme: dark)").matches; r.dataset.theme = dark ? "light" : "dark"; }
/** One-thumb bar on phones while reading a lead in call mode. */
export function callBarMobile(){
  if(state.view!=="lead") return "";
  const l = db.leads.find(x=>x.id===state.id); if(!l) return "";
  const p = l.phones[0]; const {q,i} = callQueue();
  return `<div class="callbar" data-testid="lead-call-bar">
    <div class="row1">
      ${p ? callBtn(l,p.n,"lg").replace("☎ Call","☎ Call") : '<span class="btn gray lg" aria-disabled="true">No number</span>'}
      ${p ? textBtn(l,p.n,"lg") : ""}
      <button class="btn lg" onclick="document.getElementById('actForm')?.scrollIntoView({behavior:'smooth',block:'center'})">Log</button>
    </div>
    <div class="row2">
      <button class="btn plain sm" ${q.length<2?"disabled":""} onclick="queueGo(-1)">‹ Previous</button>
      <span class="small muted">${i>=0?`${i+1} of ${q.length}`:""}</span>
      <button class="btn plain sm" ${q.length<2?"disabled":""} onclick="queueGo(1)">Next ›</button>
    </div>
  </div>`;
}


// ================================================================ ADMIN: users, roles, teams
/* Passwords are never stored or shown in clear. They are salted and hashed
   with SHA-256 in the browser (this is a demo; the real app leaves this to
   Supabase Auth). A temporary password is shown exactly once, when it is made. */
