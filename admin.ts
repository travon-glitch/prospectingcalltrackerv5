import { closeDlg, confirmDlg, field, openDlg, opts } from '../core/dialog.js';
import { PERMISSIONS, PERM_GROUPS, can, defaultRoles, isSuperAdmin, permsFrom, roleName } from '../core/permissions.js';
import { BACKEND, audit, initials, me, memberName, teamsOf } from '../core/session.js';
import { V, state } from '../core/state.js';
import { $, esc, fmtDT, toast } from '../core/util.js';
import { db, nid } from '../data/persist.js';
import { roles as supabaseRoles } from '../data/repo-supabase.js';
import { lastActivityOf } from '../features/admin.js';
import { rangeFor, stats } from '../features/stats.js';
import { draw } from '../main.js';
import type { Member, PermMap } from '../types.js';

// ADM.roles's mutations (savePermissions/roleDlg/deleteRole) are the only
// ones this stage moves off direct db.roles writes — everything else in
// this file (users, teams) still writes the local demo database exactly as
// before, same "implement now so a later stage only wires UI" boundary
// Stage 3 drew around auth. On the local backend db.roles already *is* the
// full source of truth, so those functions keep mutating it directly and
// unchanged; on the supabase backend they delegate to repoSupabase.roles,
// which calls the save-permissions edge function and then refreshes
// db.roles from the real tables (core/permissions.js's
// loadRolesAndPermissions()) so the very next render reads the saved state.

export const ADMIN_TABS: [string, string, () => boolean][] = [["users","Users",()=>can("createUsers")||can("editUsers")||can("deactivateUsers")||can("resetPasswords")],["roles","Roles & permissions",()=>can("createRoles")||can("editPermissions")],["teams","Teams",()=>can("createTeams")||can("editTeams")||can("assignMembers")||can("assignManagers")]];
export const adminTabs = () => ADMIN_TABS.filter(t=>t[2]());
export const canAdmin = () => adminTabs().length > 0;
V.admin = () => {
  const tabs = adminTabs();
  if(!tabs.length) return '<div class="card empty">User management is turned off for your role.</div>';
  const tab = tabs.some(t=>t[0]===state.adminTab) ? state.adminTab! : tabs[0][0];
  return `<div class="page-head"><div><h2>Admin</h2><p>Users, roles and permissions, teams</p></div></div>
  <div class="seg" style="margin-bottom:16px;max-width:100%;overflow:auto" id="adminTabs">${tabs.map(([k,t])=>`<button class="${tab===k?"on":""}" onclick="state.adminTab='${k}';draw()" data-tab="${k}">${t}</button>`).join("")}</div>
  ${ADM[tab] ? ADM[tab]() : ""}`;
};
export const ADM: Record<string, () => string> = {};

/* ------------------------------------------------------------ users */
// lastActivityOf/userDlg/saveUser/setUserTeams/deactivate/reactivate/
// toggleMember/resetPasswordDlg/userActivity/setRole/inviteDlg/
// acceptInvite all moved to features/admin.js (Stage 12) — this render
// function is the only piece of the Users tab that stays here, and it
// references those by name in onclick="..." strings, which resolve off
// `window` (main.js's own Object.assign(window, {...}) exposure), same as
// every other tab's onclick handlers in this file.
ADM.users = () => {
  const list = db.members.slice().sort((a,b)=> ((b.active as unknown as number)-(a.active as unknown as number)) || a.name.localeCompare(b.name));
  const mayCreate = can("createUsers"), mayEdit = can("editUsers");
  return `<div class="card flush">
    <div class="page-head" style="padding:16px 16px 0"><div><h4 style="margin:0">Users</h4><p class="small muted" style="margin:4px 0 0">${db.members.filter(m=>m.active).length} active · ${db.members.filter(m=>!m.active).length} deactivated</p></div>
      <div class="actions">${mayCreate?`<button class="btn" onclick="userDlg()" data-testid="new-user">+ New user</button>`:""}</div></div>
    <div class="tbl admin-tbl"><table><thead><tr><th>Name</th><th>Role</th><th>Teams</th><th>Status</th><th>Last login</th><th>Last activity</th><th></th></tr></thead><tbody>
    ${list.map(m=>`<tr class="row" data-user="${m.id}"><td><div class="row-line" style="padding:0;border:0"><span class="avatar">${esc(initials(m.name))}</span><div style="min-width:0"><b>${esc(m.name)}</b>${m.id===me!.id?' <span class="badge blue">you</span>':""}<div class="small muted">${esc(m.email)}</div></div></div></td>
      <td><span class="badge ${isSuperAdmin(m)?"blue":""}">${esc(roleName(m))}</span></td>
      <td class="small">${teamsOf(m.id).map(t=>`<span class="badge" style="background:${t.color}22;color:${t.color}">${esc(t.name)}</span>`).join(" ")||"—"}</td>
      <td>${m.active?`<span class="badge green">active</span>`:`<span class="badge">deactivated</span>`}${m.mustChangePw&&m.active?` <span class="badge orange" title="Must change password at next sign-in">temp password</span>`:""}</td>
      <td class="small">${m.lastLogin?fmtDT(m.lastLogin):"never"}</td>
      <td class="small">${fmtDT(lastActivityOf(m.id))}</td>
      <td><div class="actions" style="justify-content:flex-end">
        <button class="btn plain sm" onclick="userActivity(${m.id})">Activity</button>
        ${mayEdit?`<button class="btn plain sm" onclick="userDlg(${m.id})" data-testid="edit-user">Edit</button>`:""}
        ${can("resetPasswords")&&m.id!==me!.id?`<button class="btn plain sm" onclick="resetPasswordDlg(${m.id})">Reset password</button>`:""}
        ${can("deactivateUsers")&&m.id!==me!.id?`<button class="btn plain sm ${m.active?"":""}" onclick="toggleMember(${m.id})">${m.active?"Deactivate":"Reactivate"}</button>`:""}
      </div></td></tr>`).join("")}
    </tbody></table></div></div>
    <p class="small muted" style="margin:10px 0 0">Passwords are stored as salted hashes and are never shown. A temporary password is displayed once, when it is created, and the user must change it after signing in. Deactivating keeps every call, text and note the person logged.</p>`;
};

/* ------------------------------------------------------------ roles */
ADM.roles = () => {
  const mayEdit = can("editPermissions"), mayCreate = can("createRoles");
  const sel = db.roles.find(r=>r.id===state.roleSel) || db.roles[0];
  const inUse = db.members.filter(m=>m.role===sel.id).length;
  const locked = !mayEdit || sel.superAdmin;
  return `<div class="grid" style="grid-template-columns:280px 1fr;gap:16px" id="rolesGrid">
    <div class="card flush"><ul class="role-list">${db.roles.map(r=>`<li class="${r.id===sel.id?"on":""}" onclick="state.roleSel='${r.id}';draw()"><b>${esc(r.name)}</b><div class="small muted">${db.members.filter(m=>m.role===r.id).length} user${db.members.filter(m=>m.role===r.id).length===1?"":"s"} · ${r.superAdmin?"everything":Object.values(r.perms).filter(Boolean).length+" permissions"}${r.builtIn?"":" · custom"}</div></li>`).join("")}</ul>
      ${mayCreate?`<div style="padding:12px"><button class="btn tint sm" style="width:100%" onclick="roleDlg()" data-testid="new-role">+ New role</button></div>`:""}</div>
    <div class="card" id="perms" data-role="${sel.id}">
      <div class="page-head" style="margin-bottom:8px"><div><h4 style="margin:0">${esc(sel.name)} ${sel.builtIn?'<span class="badge">built-in</span>':'<span class="badge blue">custom</span>'}</h4><p class="small muted" style="margin:4px 0 0">${esc(sel.description||"")}</p></div>
        <div class="actions">${mayEdit&&!sel.superAdmin?`<button class="btn plain sm" onclick="roleDlg('${sel.id}')">Rename</button>`:""}${mayEdit&&!sel.builtIn?`<button class="btn plain sm" onclick="deleteRole('${sel.id}')">Delete</button>`:""}</div></div>
      ${sel.superAdmin?'<div class="alert gray small">The Super Administrator always has every permission. It cannot be reduced, and the last active Super Administrator cannot be deactivated or demoted.</div>':""}
      ${locked?"":`<div class="actions" style="margin:6px 0 10px"><button class="btn tint sm" onclick="permsSetAll(true)">Select all</button><button class="btn tint sm" onclick="permsSetAll(false)">Clear all</button><select id="copyFrom" style="width:auto" onchange="permsCopyFrom(this.value);this.value=''">${opts(db.roles.filter(r=>r.id!==sel.id).map(r=>[r.id,r.name]),"","Copy permissions from…")}</select></div>`}
      ${PERM_GROUPS.map(g=>{ const ks = PERMISSIONS.filter(c=>c[2]===g); const on = ks.filter(c=>sel.perms[c[0]]).length; return `<details class="adm-details" ${state.permOpen?.[g]===false?"":"open"} ontoggle="(state.permOpen=state.permOpen||{})['${g}']=this.open"><summary>${esc(g)} <span class="badge">${on}/${ks.length}</span></summary>
        <div class="perm-grid">${ks.map(([k,label])=>`<label class="perm"><span>${esc(label)}</span><input type="checkbox" class="switch" data-cap="${k}" data-role="${sel.id}" ${sel.perms[k]?"checked":""} ${locked?"disabled":""}></label>`).join("")}</div></details>`; }).join("")}
      ${locked?"":`<div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn sm" onclick="savePermissions()" data-testid="save-permissions">Save permissions</button></div>`}
      <p class="small muted" style="margin:10px 0 0">${inUse} user${inUse===1?"":"s"} currently ${inUse===1?"has":"have"} this role. Changes take effect immediately, everywhere in the app${mayEdit?"":". Only a Super Administrator (or a role with “Edit permissions”) can change them"}.</p>
    </div></div>`;
};
export function permsSetAll(v: boolean){ document.querySelectorAll<HTMLInputElement>("#perms input[data-cap]:not([disabled])").forEach(i=>i.checked=v); }
export function permsCopyFrom(id: string){ const r=db.roles.find(x=>x.id===id); if(!r) return; document.querySelectorAll<HTMLInputElement>("#perms input[data-cap]:not([disabled])").forEach(i=>i.checked=!!(r.perms as Record<string, boolean>)[i.dataset.cap!]); toast(`Copied from ${r.name} — not saved yet`); }
export async function savePermissions(){
  if(!can("editPermissions")) return toast("You don't have permission to do that");
  const box = $("#perms"); const r = db.roles.find(x=>x.id===box?.dataset.role); if(!r || r.superAdmin) return;
  const next: PermMap = {...r.perms}; box.querySelectorAll<HTMLInputElement>("input[data-cap]").forEach(i=>{ (next as Record<string, boolean>)[i.dataset.cap!] = i.checked; });
  if(r.id===me!.role && !next.editPermissions){ return toast("You can't remove your own “Edit permissions” — ask another administrator"); }
  if(BACKEND==="supabase"){
    // The edge function writes its own audit_log row server-side, so there's
    // no client-side audit() call to mirror here (unlike the local branch).
    try{ await supabaseRoles.save(r.id, next); }catch(e){ return toast((e as Error).message); }
    toast("Permissions saved"); draw();
    return;
  }
  r.perms = next; const n = Object.values(next).filter(Boolean).length;
  audit("updated","roles",`${r.name} · ${n} permissions`); toast("Permissions saved"); draw();
}
export function resetPermissions(){ if(!can("editPermissions")) return; const d = defaultRoles(); for(const r of db.roles){ const def = d.find(x=>x.id===r.id); if(def) r.perms = def.perms; } audit("reset","roles","built-in roles back to defaults"); toast("Back to the defaults"); draw(); }
export function roleDlg(id?: string){ const r = id ? db.roles.find(x=>x.id===id) : null;
  const suggestions = ["Team Leader","Listing Manager","Buyer Agent","Transaction Coordinator","Recruiter","Coach","Marketing Manager","Virtual Assistant"];
  openDlg(`<div class="body"><h3>${r?"Rename role":"New role"}</h3>${field("Name",`<input id="rN" value="${esc(r?.name||"")}" list="roleSug" placeholder="e.g. Team Leader"><datalist id="roleSug">${suggestions.map(s=>`<option value="${esc(s)}">`).join("")}</datalist>`)}${field("Description",`<input id="rD" value="${esc(r?.description||"")}" placeholder="What this person does">`)}
    ${r?"":field("Start from",`<select id="rC">${opts(db.roles.filter(x=>!x.superAdmin).map(x=>[x.id,x.name]),"agent","Nothing (all off)")}</select>`)}</div>
    <div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="rOk" data-testid="save-role">${r?"Save":"Create role"}</button></div>`);
  $("#rOk").onclick = async () => { const name=$("#rN").value.trim(); if(!name) return toast("Give the role a name"); if(db.roles.some(x=>x.name.toLowerCase()===name.toLowerCase() && x.id!==r?.id)) return toast("A role with that name already exists");
    if(BACKEND==="supabase"){
      try{
        if(r) await supabaseRoles.rename(r.id, name, $("#rD").value.trim());
        else { const baseId = $("#rC").value; const nr = { id:"r"+nid() }; await supabaseRoles.create(nr.id, name, $("#rD").value.trim(), baseId); state.roleSel=nr.id; }
      }catch(e){ return toast((e as Error).message); }
      closeDlg(); toast("Saved"); draw();
      return;
    }
    if(r){ r.name=name; r.description=$("#rD").value.trim(); audit("updated","roles",name); }
    else { const base = db.roles.find(x=>x.id===$("#rC").value); const nr = { id:"r"+nid(), name, description:$("#rD").value.trim(), builtIn:false, perms: base ? {...base.perms} : permsFrom([]) }; db.roles.push(nr); state.roleSel=nr.id; audit("created","roles",name); }
    closeDlg(); toast("Saved"); draw(); };
}
export function deleteRole(id: string){ const r=db.roles.find(x=>x.id===id); if(!r || r.builtIn) return; const n=db.members.filter(m=>m.role===id).length;
  if(n) return toast(`${n} user${n===1?" has":"s have"} this role — move them to another role first`);
  confirmDlg(`Delete the role “${r.name}”?`, "Nobody has it, so nothing else changes.", "Delete", async ()=>{
    if(BACKEND==="supabase"){
      try{ await supabaseRoles.delete(id); }catch(e){ return toast((e as Error).message); }
      state.roleSel=null; draw();
      return;
    }
    db.roles=db.roles.filter(x=>x.id!==id); state.roleSel=null; audit("deleted","roles",r.name); draw();
  }); }

/* ------------------------------------------------------------ teams */
// TEAM_COLORS/teamDlg/teamLogoPick/archiveTeam/restoreTeam/teamPerf all
// moved to features/admin.js (Stage 12) — referenced only by name in
// onclick="..." strings below, resolved off `window` same as above.
ADM.teams = () => {
  const showArchived = !!state.teamsArchived;
  const teams = db.teams.filter(t=>!!t.archived===showArchived);
  return `<div class="page-head" style="margin-bottom:10px"><div><p class="small muted" style="margin:0">${db.teams.filter(t=>!t.archived).length} active · ${db.teams.filter(t=>t.archived).length} archived. A person can belong to more than one team; history is kept when they move.</p></div>
    <div class="actions"><span class="seg"><button class="${showArchived?"":"on"}" onclick="state.teamsArchived=false;draw()">Active</button><button class="${showArchived?"on":""}" onclick="state.teamsArchived=true;draw()">Archived</button></span>${can("createTeams")?`<button class="btn" onclick="teamDlg()" data-testid="new-team">+ New team</button>`:""}</div></div>
  <div class="grid g3">${teams.map(t=>{ const members = t.memberIds.map(id=>db.members.find(m=>m.id===id)).filter(Boolean) as Member[]; const r = rangeFor("week"); const s = members.reduce((a,m)=>{const x=stats(m.id,r); a.calls+=x.calls; a.conv+=x.conv; a.appts+=x.appts; return a;},{calls:0,conv:0,appts:0});
    return `<div class="card team-card" data-team="${t.id}"><div class="row-line" style="padding:0;border:0"><span class="team-logo" style="background:${t.color}">${t.logo?`<img src="${t.logo}" alt="">`:esc(initials(t.name))}</span><div style="flex:1;min-width:0"><b style="font-size:16px">${esc(t.name)}</b><div class="small muted">${esc(t.description||"")}</div></div></div>
      <div class="small" style="margin:10px 0 6px">Manager: <b>${esc(t.managerId?memberName(t.managerId):"—")}</b> · ${members.length} member${members.length===1?"":"s"}</div>
      <div class="avatars">${members.slice(0,8).map(m=>`<span class="avatar" title="${esc(m.name)}" style="${m.active?"":"opacity:.45"}">${esc(initials(m.name))}</span>`).join("")}${members.length>8?`<span class="small muted">+${members.length-8}</span>`:""}</div>
      <div class="grid g3 small" style="margin-top:10px;gap:8px"><div><div class="muted">Calls this week</div><b>${s.calls}</b></div><div><div class="muted">Conversations</div><b>${s.conv}</b></div><div><div class="muted">Appointments</div><b>${s.appts}</b></div></div>
      ${(t.listIds?.length||t.campaignIds?.length)?`<div class="small muted" style="margin-top:8px">${t.listIds.map(id=>db.lists.find(l=>l.id===id)?.name).filter(Boolean).map(n=>`<span class="badge">${esc(n)}</span>`).join(" ")} ${t.campaignIds.map(id=>db.campaigns.find(c=>c.id===id)?.name).filter(Boolean).map(n=>`<span class="badge blue">${esc(n)}</span>`).join(" ")}</div>`:""}
      <div class="actions" style="margin-top:12px"><button class="btn tint sm" onclick="teamPerf(${t.id})">Performance</button>${can("editTeams")?`<button class="btn plain sm" onclick="teamDlg(${t.id})" data-testid="edit-team">Edit</button>`:""}${can("editTeams")?(t.archived?`<button class="btn plain sm" onclick="restoreTeam(${t.id})">Restore</button>`:`<button class="btn plain sm" onclick="archiveTeam(${t.id})">Archive</button>`):""}</div></div>`; }).join("")||`<div class="card empty">${showArchived?"No archived teams.":"No teams yet."}</div>`}</div>`;
};

/* ------------------------------------------------------------ sign-in */
