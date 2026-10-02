import { closeDlg, confirmDlg, field, listOpts, memberOpts, openDlg, opts } from '../core/dialog.js';
import { BUILT_IN_DEFAULT_LABEL, CF_TYPES, CF_TYPE_LABEL, activeFields, allFields, cardFieldsFor, columnChoices, defaultBuiltInFields, keyFromLabel, keyProblem, resolvedColumns } from '../core/fields.js';
import { can, roleName } from '../core/permissions.js';
import { go } from '../core/router.js';
import { BACKEND, audit, me } from '../core/session.js';
import { V, state } from '../core/state.js';
import { STATUS_TONES, statusList } from '../core/statuses.js';
import { $, copyText, esc, toast } from '../core/util.js';
import { db, nid } from '../data/persist.js';
import { badge, outcome } from '../features/activity.js';
import { addStageDlg, archivePipeline, num, pipeline, pipelineDlg, restorePipeline, restoreStage, stageMenu } from '../features/crm.js';
import { exportCsv } from '../features/exports.js';
import { draw } from '../main.js';
import { canAdmin } from './admin.js';
import { statuses as statusesRepo, fields as fieldsRepo, outcomes as outcomesRepo } from '../data/repo-supabase.js';
import type { CustomField } from '../types.js';

V.settings = () => {
  const tabs = [["team","Team & permissions"],["fields","Fields & columns"],["import","Import"],["outcomes","Outcomes & statuses"],["pipelines","CRM pipelines"],["scoring","Scoring & goals"],["data","Data & exports"],["about","Compliance"]];
  const tab = state.setTab || "team";
  return `<div class="page-head"><div><h2>Settings</h2><p>${esc(db.settings.teamName)} · you are ${esc(roleName(me))}</p></div>
    <div class="actions">${can("viewAudit")?`<button class="btn tint" onclick="go('audit')">Audit log</button>`:""}<button class="btn plain" onclick="signOut()">Sign out</button></div></div>
  <div class="seg" style="margin-bottom:16px;max-width:100%;overflow:auto" id="setTabs">
    ${tabs.map(([k,t])=>`<button class="${tab===k?"on":""}" onclick="state.setTab='${k}';draw()" data-tab="${k}">${t}</button>`).join("")}
  </div>
  ${SET[tab] ? SET[tab]() : ""}`;
};

export const SET: Record<string, () => string> = {};

/* ---------------------------------------------------------------- team */
SET.team = () => {
  const s = db.settings;
  return `<div class="grid g2">
    <div class="card"><h4>Team name</h4>
      ${can("manageSettings")?`${field("Team name",`<input id="sN" value="${esc(s.teamName)}">`)}${field("Your name in {{agent_name}}",`<input id="sAg" value="${esc(s.agentName)}">`)}
      <div class="actions" style="justify-content:flex-end;margin-top:10px"><button class="btn sm" onclick="saveTeamName()">Save</button></div>`:`<p class="small muted">Only an administrator can change this.</p>`}</div>
    <div class="card"><h4>Users, roles and teams</h4><p class="small muted">Creating users, temporary passwords, custom roles with their own permissions, and teams now live in <b>Admin</b>.</p>
      <div class="actions" style="margin-top:10px">${canAdmin()?`<button class="btn tint sm" onclick="state.adminTab='users';go('admin')">Users</button><button class="btn tint sm" onclick="state.adminTab='roles';go('admin')">Roles &amp; permissions</button><button class="btn tint sm" onclick="state.adminTab='teams';go('admin')">Teams</button>`:`<span class="small muted">Not available for your role.</span>`}</div>
      <p class="small muted" style="margin:12px 0 0">You are signed in as <b>${esc(me!.name)}</b> — ${esc(roleName(me))}.</p></div>
  </div>`;
};

/* -------------------------------------------------------------- fields */
SET.fields = () => {
  const mg = can("manageFields");
  return `<div class="grid">
    <div class="card" id="customFields"><h4>Your own fields</h4>
      <p class="small muted" style="margin:0 0 10px">Columns for anything your spreadsheets carry that the app doesn't already have. Each one can be filled from an import, edited on a lead, shown as a column, and dropped into a campaign message as a merge field.</p>
      ${mg?`<div class="actions" style="margin-bottom:10px"><button class="btn sm" onclick="fieldForm()" data-testid="new-field">+ New field</button></div>`:""}
      ${allFields().length ? `<ul>${allFields().map((f,i)=>`<li class="row-line" style="align-items:flex-start">
        ${mg?`<div style="display:flex;flex-direction:column;gap:2px"><button class="btn plain sm" ${i===0?"disabled":""} onclick="moveField(${f.id},-1)" aria-label="Move ${esc(f.label)} up">▲</button><button class="btn plain sm" ${i===allFields().length-1?"disabled":""} onclick="moveField(${f.id},1)" aria-label="Move ${esc(f.label)} down">▼</button></div>`:""}
        <div style="flex:1;min-width:0;${f.active?"":"opacity:.55"}">
          <b>${esc(f.label)}</b> <span class="badge">${CF_TYPE_LABEL[f.type]}</span> ${f.active?"":'<span class="badge">Off</span>'} ${f.inTable?'<span class="badge blue">In leads table</span>':""} ${f.onCard?'<span class="badge blue">On campaign cards</span>':""}
          <div><button class="btn plain sm" style="padding-left:0" onclick="copyText('{{${f.key}}}')" title="Copy the merge field">{{${f.key}}} ⧉</button></div>
          ${f.type==="choice"&&f.choices.length?`<div class="small muted">Options: ${f.choices.map(esc).join(", ")}</div>`:""}
          ${f.hint?`<div class="small muted">${esc(f.hint)}</div>`:""}
          <div class="small muted">Filled in on ${db.leads.filter(l=>!l.archived && (l.custom||{})[f.key]!==undefined).length} lead(s)</div>
        </div>
        ${mg?`<div class="actions"><button class="btn tint sm" onclick="fieldForm(${f.id})">Edit</button><button class="btn plain sm" onclick="toggleField(${f.id})">${f.active?"Turn off":"Turn on"}</button><button class="btn plain sm" style="color:var(--danger)" onclick="deleteField(${f.id})">Delete</button></div>`:""}
      </li>`).join("")}</ul>` : '<p class="small muted">No custom fields yet. Add one for listing price, expired date, equity, motivation, lockbox code — whatever your lists carry.</p>'}
    </div>

    <div class="card"><h4>Built-in fields</h4>
      <p class="small muted" style="margin:0 0 8px">Rename them to match how your team talks, hide the ones you never use, or make one required when adding a lead by hand.</p>
      <div class="tbl"><table><thead><tr><th>Field</th><th>What you call it</th><th style="text-align:center">Show</th><th style="text-align:center">Required</th></tr></thead><tbody>
        ${(db.settings.builtInFields||[]).map(f=>`<tr>
          <td class="small muted">${esc(BUILT_IN_DEFAULT_LABEL[f.key]||f.key)}</td>
          <td><input data-bif="${f.key}" data-k="label" value="${esc(f.label)}" ${mg?"":"disabled"}></td>
          <td style="text-align:center"><input type="checkbox" data-bif="${f.key}" data-k="visible" ${f.visible!==false?"checked":""} ${mg&&!f.always?"":"disabled"} title="${f.always?"Always shown":""}"></td>
          <td style="text-align:center"><input type="checkbox" data-bif="${f.key}" data-k="required" ${f.required?"checked":""} ${mg?"":"disabled"}></td>
        </tr>`).join("")}
      </tbody></table></div>
      ${mg?`<div class="actions" style="justify-content:flex-end;margin-top:10px"><button class="btn plain sm" onclick="db.settings.builtInFields=defaultBuiltInFields();toast('Back to the defaults');draw()">Reset</button><button class="btn sm" onclick="saveBuiltInFields()" data-testid="save-builtin">Save fields</button></div>`:""}
    </div>

    ${mg?`<div class="card"><h4>Columns your team sees</h4>
      <p class="small muted" style="margin:0 0 8px">Tick what shows in the leads table and on each campaign message card. Everything stays searchable either way.</p>
      <div class="grid g2">
        <div><label class="f" style="margin-top:0">Leads table</label><div class="checks" id="colPick">${columnChoices().map(c=>`<label><input type="checkbox" value="${esc(c.id)}" ${resolvedColumns().some(x=>x.id===c.id)?"checked":""}> ${esc(c.label)}${c.custom?' <span class="muted small">(custom)</span>':""}</label>`).join("")}</div></div>
        <div><label class="f" style="margin-top:0">Campaign message cards</label>${activeFields().length?`<div class="checks" id="cardPick">${activeFields().map(f=>`<label><input type="checkbox" value="${esc(f.key)}" ${cardFieldsFor().some(x=>x.key===f.key)?"checked":""}> ${esc(f.label)}</label>`).join("")}</div>`:'<p class="small muted">Create a custom field and it will appear here.</p>'}<p class="small muted" style="margin-top:8px">The name, address, phone, status and the message itself are always on the card.</p></div>
      </div>
      <div class="actions" style="justify-content:flex-end;margin-top:10px"><button class="btn plain sm" onclick="db.settings.tableColumns=[];db.settings.cardFields=[];toast('Back to the default columns');draw()">Reset to default</button><button class="btn sm" onclick="saveColumns()" data-testid="save-columns">Save columns</button></div>
    </div>`:""}
  </div>`;
};

/* -------------------------------------------------------------- import */
SET.import = () => {
  const mg = can("manageSettings"); const c = db.settings.importCfg;
  return `<div class="grid g2">
    <div class="card" style="grid-column:1/-1"><h4>How many columns the import offers</h4>
      <p class="small muted" style="margin:0 0 10px">Different lists carry different amounts of data. A skip-traced list might have eight numbers per owner; an MLS export might have one. Set the slots here and the column-matching step offers exactly that many.</p>
      <div class="grid g3" style="gap:0 12px">
        ${field("Phone number columns", `<input type="number" id="icPhones" min="1" max="20" value="${c.phoneSlots}" ${mg?"":"disabled"}>`)}
        ${field("Email columns", `<input type="number" id="icEmails" min="1" max="5" value="${c.emailSlots}" ${mg?"":"disabled"}>`)}
        ${field("Most rows in one file", `<input type="number" id="icMax" min="100" max="200000" step="100" value="${c.maxRows}" ${mg?"":"disabled"}>`)}
      </div>
      <p class="small muted">Phone 1 … Phone ${c.phoneSlots} right now. The first number becomes the primary; the rest are kept on the lead and can be called or texted from the lead page.</p>
    </div>

    <div class="card"><h4>What counts as a duplicate</h4>
      <p class="small muted" style="margin:0 0 8px">Checked against leads you already have, and against the rest of the file. Turn one off if your lists share it legitimately — several owners at one address, for instance.</p>
      <div class="checks">
        <label><input type="checkbox" id="icDupP" ${c.dupPhone?"checked":""} ${mg?"":"disabled"}> Same phone number</label>
        <label><input type="checkbox" id="icDupE" ${c.dupEmail?"checked":""} ${mg?"":"disabled"}> Same email address</label>
        <label><input type="checkbox" id="icDupA" ${c.dupAddress?"checked":""} ${mg?"":"disabled"}> Same street address and ZIP</label>
      </div>
      <p class="small muted" style="margin-top:8px">With all three off, nothing is flagged and every row imports.</p>
    </div>

    <div class="card"><h4>Which rows to keep</h4>
      <div class="checks">
        <label><input type="checkbox" id="icReqN" ${c.requireName?"checked":""} ${mg?"":"disabled"}> Skip rows with no name</label>
        <label><input type="checkbox" id="icReqP" ${c.requirePhone?"checked":""} ${mg?"":"disabled"}> Skip rows with no usable phone number</label>
        <label><input type="checkbox" id="icDnc" ${c.flagDnc?"checked":""} ${mg?"":"disabled"}> Read "DNC" or "do not call" in a Tags or Notes column as Do Not Call</label>
      </div>
      <p class="small muted" style="margin-top:8px">A row with nothing usable at all — no name, no phone, no address — is always skipped.</p>
      <hr style="border:0;border-top:1px solid var(--border);margin:14px 0">
      <h4>Defaults for a new import</h4>
      <div class="grid g2" style="gap:0 12px">
        ${field("Assign to", `<select id="icAssign" ${mg?"":"disabled"}>${memberOpts(c.defaultAssign,"Leave unassigned")}</select>`)}
        ${field("Import into", `<select id="icList" ${mg?"":"disabled"}>${listOpts(c.defaultList,"New list from the file name")}</select>`)}
      </div>
    </div>

    ${mg?`<div class="card" style="grid-column:1/-1"><div class="actions" style="justify-content:flex-end"><button class="btn plain sm" onclick="db.settings.importCfg={phoneSlots:10,emailSlots:1,dupPhone:true,dupEmail:true,dupAddress:true,maxRows:50000,requireName:false,requirePhone:false,flagDnc:true,defaultAssign:'',defaultList:''};toast('Back to the defaults');draw()">Reset</button><button class="btn" onclick="saveImportCfg()" data-testid="save-import">Save import settings</button></div></div>`:""}
  </div>`;
};

/* ------------------------------------------------- outcomes & statuses */
SET.outcomes = () => {
  const mo = can("manageOutcomes"); const ms = can("manageStatuses");
  return `<div class="grid g2">
    <div class="card"><h4>Call outcomes</h4>
      <p class="small muted" style="margin:0 0 8px">The buttons a caller taps after an attempt. What each one counts as decides your contact rate and points.</p>
      <ul>${db.outcomes.map(o=>`<li class="row-line"><span style="flex:1;${o.disabled?'opacity:.5;text-decoration:line-through':''}">${esc(o.name)}</span>${o.conv?'<span class="badge green">conversation</span>':""}${o.appt?'<span class="badge green">appointment</span>':""}${o.dnc?'<span class="badge red">sets DNC</span>':""}${mo?`<button class="btn plain sm" onclick="outcomeForm(${o.id})">Edit</button>`:""}</li>`).join("")}</ul>
      ${mo?`<button class="btn tint sm" style="margin-top:12px" onclick="outcomeForm()" data-testid="new-outcome">+ New outcome</button>`:""}
    </div>

    <div class="card"><h4>Lead statuses</h4>
      <p class="small muted" style="margin:0 0 8px">Where a lead sits in your pipeline. Rename them, recolour them, or add your own — the built-in ones are set automatically when you log an outcome, so they can't be removed.</p>
      <ul>${statusList().map((x,i)=>`<li class="row-line">
        ${ms?`<div style="display:flex;flex-direction:column;gap:2px"><button class="btn plain sm" ${i===0?"disabled":""} onclick="moveStatus('${x.key}',-1)" aria-label="Move ${esc(x.label)} up">▲</button><button class="btn plain sm" ${i===statusList().length-1?"disabled":""} onclick="moveStatus('${x.key}',1)" aria-label="Move ${esc(x.label)} down">▼</button></div>`:""}
        <span style="flex:1;${x.active===false?"opacity:.5":""}"><span class="badge ${x.tone||""}">${esc(x.label)}</span> ${x.locked?'<span class="small muted">built in</span>':""}</span>
        <span class="small muted">${db.leads.filter(l=>!l.archived&&l.status===x.key).length}</span>
        ${ms?`<div class="actions"><button class="btn plain sm" onclick="statusForm('${x.key}')">Edit</button>${x.locked?"":`<button class="btn plain sm" style="color:var(--danger)" onclick="deleteStatus('${x.key}')">Delete</button>`}</div>`:""}
      </li>`).join("")}</ul>
      ${ms?`<button class="btn tint sm" style="margin-top:12px" onclick="statusForm()" data-testid="new-status">+ New status</button>`:""}
    </div>
  </div>`;
};

/* ------------------------------------------------------------- scoring */
SET.scoring = () => {
  const s = db.settings; const mg = can("manageSettings");
  if(!mg) return `<div class="card"><p class="small muted">Only managers can change scoring. Current: ${s.ptsCall}/call, ${s.ptsConv}/conversation, ${s.ptsAppt}/appointment, goal ${s.weeklyGoal} calls a week.</p></div>`;
  return `<div class="card"><h4>Scoring &amp; goals</h4>
    <div class="grid g3" style="gap:0 12px">${field("Points per call",`<input type="number" id="sC" value="${s.ptsCall}">`)}${field("Per text",`<input type="number" id="sT" value="${s.ptsText}">`)}${field("Per door knock",`<input type="number" id="sD" value="${s.ptsDoor}">`)}${field("Per conversation",`<input type="number" id="sV" value="${s.ptsConv}">`)}${field("Per appointment",`<input type="number" id="sA" value="${s.ptsAppt}">`)}${field("Weekly call goal (per caller)",`<input type="number" id="sG" value="${s.weeklyGoal}">`)}</div>
    <label class="f">Working days (used for pace)</label><div class="seg" id="wd">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((x,i)=>`<button class="${s.workingDays.includes(i+1)?"on":""}" data-d="${i+1}" onclick="this.classList.toggle('on')">${x}</button>`).join("")}</div>
    <div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn sm" onclick="saveSettings()" data-testid="save-scoring">Save</button></div></div>`;
};

/* ---------------------------------------------------------------- data */
SET.data = () => `<div class="grid g2">
  <div class="card"><h4>Exports</h4><p class="small muted">CSV files with a header row, ready for Excel or Google Sheets.${can("viewAllLeads")?" You see the whole team.":" You only see your own leads and activity."}</p>
    ${can("export")?`<div class="actions">${[["leads","Leads"],["assignments","Assignments"],["activities","Activities"],["outcomes","Outcomes"],["notes","Notes"],["follow_ups","Follow-ups"],["campaigns","Campaigns"],["team_performance","Team performance"],["scoreboard","Scoreboard"]].map(([k,t])=>`<button class="btn tint sm" onclick="exportCsv('${k}')">⇩ ${t}</button>`).join("")}</div>`:`<p class="small muted">Exporting is turned off for your role.</p>`}</div>
  <div class="card"><h4>Demo data</h4><p class="small muted">Everything you change is saved in this browser, so it is still here after a refresh. Save a backup file to move it to another browser or keep a copy — your settings, permissions and fields come with it.</p>
    <div class="actions"><button class="btn tint sm" onclick="backup()">⇩ Save backup (.json)</button><button class="btn tint sm" onclick="document.getElementById('restoreIn').click()">⇪ Restore backup</button><button class="btn danger tint sm" onclick="resetDemo()">Reset demo data</button></div></div>
</div>`;

/* --------------------------------------------------------------- about */
SET.about = () => `<div class="card"><h4>Compliance notice</h4><p class="small" style="color:var(--ink-muted);margin:0">Prospecting Call Tracker helps you organise and log outreach. You and your team are responsible for following all applicable calling, texting, consent, identification, contact-hour and do-not-contact requirements (including the National Do Not Call Registry, state rules and carrier messaging policies). Marking a lead Do Not Call / Do Not Text / Do Not Contact blocks those actions inside the app, but the app does not guarantee legal compliance and does not scrub numbers against any registry.</p></div>`;

/* ------------------------------------------------------------- savers */
export function saveTeamName(){
  const s=db.settings; const teamName=$("#sN").value.trim()||s.teamName; const agentName=$("#sAg").value.trim()||s.agentName;
  if(BACKEND==="supabase"){
    fieldsRepo.saveTeamName(teamName, agentName).then(()=>{ s.teamName=teamName; s.agentName=agentName; audit("updated","team",s.teamName); toast("Saved"); draw(); }).catch(e=>toast(e.message));
    return;
  }
  s.teamName=teamName; s.agentName=agentName; audit("updated","team",s.teamName); toast("Saved"); draw();
}
export function saveBuiltInFields(){
  document.querySelectorAll<HTMLInputElement>("[data-bif]").forEach(i=>{
    const f = db.settings.builtInFields.find(x=>x.key===i.dataset.bif); if(!f) return;
    if(i.dataset.k === "label") f.label = i.value.trim() || BUILT_IN_DEFAULT_LABEL[f.key];
    else (f as unknown as Record<string, boolean>)[i.dataset.k!] = i.checked;
  });
  if(BACKEND==="supabase"){
    fieldsRepo.builtInSave(db.settings.builtInFields).then(()=>{ toast("Fields saved"); draw(); }).catch(e=>toast(e.message));
    return;
  }
  audit("updated","built_in_fields", db.settings.builtInFields.filter(f=>f.visible!==false).length + " shown");
  toast("Fields saved"); draw();
}
export function saveImportCfg(){
  const c = db.settings.importCfg;
  const num = (id: string, lo: number, hi: number, cur: number) => { const v = Math.round(+$(id).value); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : cur; };
  const next = {...c};
  next.phoneSlots = num("#icPhones", 1, 20, c.phoneSlots);
  next.emailSlots = num("#icEmails", 1, 5, c.emailSlots);
  next.maxRows    = num("#icMax", 100, 200000, c.maxRows);
  next.dupPhone = $("#icDupP").checked; next.dupEmail = $("#icDupE").checked; next.dupAddress = $("#icDupA").checked;
  next.requireName = $("#icReqN").checked; next.requirePhone = $("#icReqP").checked; next.flagDnc = $("#icDnc").checked;
  next.defaultAssign = $("#icAssign").value; next.defaultList = $("#icList").value;
  if(BACKEND==="supabase"){
    fieldsRepo.saveImportCfg(next).then(()=>{ Object.assign(c, next); toast(`Saved · imports now offer ${c.phoneSlots} phone columns`); draw(); }).catch(e=>toast(e.message));
    return;
  }
  Object.assign(c, next);
  audit("updated","import_settings", `${c.phoneSlots} phone columns`);
  toast(`Saved · imports now offer ${c.phoneSlots} phone columns`); draw();
}
export function statusForm(key?: string){
  const x = key ? statusList().find(v=>v.key===key) : null;
  openDlg(`<div class="body"><h3>${x?"Edit status":"New status"}</h3>
    ${field("Name",`<input id="stL" value="${esc(x?.label||"")}" placeholder="Nurture">`)}
    ${field("Colour",`<select id="stT">${opts(STATUS_TONES, x?.tone||"")}</select>`)}
    ${x&&!x.locked?`<label class="small" style="display:block;margin-top:10px"><input type="checkbox" id="stA" ${x.active!==false?"checked":""}> Available to choose</label>`:""}
    ${x?.locked?`<p class="small muted" style="margin-top:10px">This is a built-in status: logging an outcome can set it automatically, so it can be renamed and recoloured but not removed.</p>`:""}
  </div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="stOk">Save</button></div>`);
  $("#stOk").onclick = () => {
    const label = $("#stL").value.trim(); if(!label) return toast("Give the status a name");
    const tone = $("#stT").value;
    if(BACKEND==="supabase"){
      if(x){
        const patch: { label: string; tone: string; active?: boolean } = {label, tone}; if($("#stA")) patch.active = $("#stA").checked;
        statusesRepo.update(x.key, patch).then(()=>{ Object.assign(x, patch); closeDlg(); toast("Status saved"); draw(); }).catch(e=>toast(e.message));
      } else {
        const k = keyFromLabel(label);
        if(!k) return toast("Use letters and numbers");
        if(statusList().some(v=>v.key===k)) return toast("A status with that name already exists");
        statusesRepo.create(k, label, tone).then(()=>{ db.settings.statuses.push({key:k, label, tone, active:true}); closeDlg(); toast("Status saved"); draw(); }).catch(e=>toast(e.message));
      }
      return;
    }
    if(x){ x.label=label; x.tone=tone; if($("#stA")) x.active=$("#stA").checked; audit("updated","statuses",label); }
    else {
      const k = keyFromLabel(label);
      if(!k) return toast("Use letters and numbers");
      if(statusList().some(v=>v.key===k)) return toast("A status with that name already exists");
      db.settings.statuses.push({key:k, label, tone, active:true});
      audit("created","statuses",label);
    }
    closeDlg(); toast("Status saved"); draw();
  };
}
export function moveStatus(key: string, dir: number){
  const list = db.settings.statuses; const i = list.findIndex(x=>x.key===key); const j = i+dir;
  if(i<0 || j<0 || j>=list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  if(BACKEND==="supabase"){
    // Stage 5's statuses table has no persisted order column exposed here
    // (see 0007_statuses_and_outcomes.sql — status ordering isn't in this
    // stage's acceptance list the way the fields' order is), so a reorder
    // is reflected locally for this session only; it resets on reload.
    draw();
    return;
  }
  draw();
}
export function deleteStatus(key: string){
  const x = statusList().find(v=>v.key===key)!;
  const n = db.leads.filter(l=>!l.archived && l.status===key).length;
  confirmDlg("Delete this status?", n ? `${n} lead(s) currently have "${x.label}" and will move back to New.` : `"${x.label}" will be removed.`, "Delete", ()=>{
    if(BACKEND==="supabase"){
      statusesRepo.delete(key).then(()=>{
        db.leads.forEach(l=>{ if(l.status===key) l.status="new"; });
        db.settings.statuses = db.settings.statuses.filter(v=>v.key!==key);
        toast("Status deleted"); draw();
      }).catch(e=>toast(e.message));
      return;
    }
    db.leads.forEach(l=>{ if(l.status===key) l.status="new"; });
    db.settings.statuses = db.settings.statuses.filter(v=>v.key!==key);
    audit("deleted","statuses",x.label); toast("Status deleted"); draw();
  });
}

export function saveSettings(){
  const s = db.settings;
  const v = (id: string) => { const n = Math.round(+$(id).value); return isFinite(n) ? Math.max(0, Math.min(1000, n)) : 0; };
  const wd = [...document.querySelectorAll<HTMLElement>("#wd button.on")].map(b=>+b.dataset.d!);
  if(!wd.length) return toast("Pick at least one working day");
  const patch = { ptsCall:v("#sC"), ptsText:v("#sT"), ptsDoor:v("#sD"), ptsConv:v("#sV"), ptsAppt:v("#sA"),
                   weeklyGoal: Math.max(0, Math.round(+$("#sG").value || 0)), workingDays: wd };
  if(BACKEND==="supabase"){
    fieldsRepo.saveScoring({ pts_call:patch.ptsCall, pts_text:patch.ptsText, pts_door:patch.ptsDoor, pts_conv:patch.ptsConv, pts_appt:patch.ptsAppt, weekly_goal:patch.weeklyGoal, working_days:patch.workingDays })
      .then(()=>{ Object.assign(s, patch); audit("updated","scoring_settings",`goal ${s.weeklyGoal}, ${wd.length} working days`); toast("Settings saved"); draw(); })
      .catch(e=>toast(e.message));
    return;
  }
  Object.assign(s, patch);
  audit("updated","scoring_settings",`goal ${s.weeklyGoal}, ${wd.length} working days`);
  toast("Settings saved"); draw();
}
export function outcomeForm(id?: number){ const o=db.outcomes.find(x=>x.id===id); openDlg(`<div class="body"><h3>${o?"Edit":"New"} outcome</h3>${field("Name",`<input id="oN" value="${esc(o?.name||"")}">`)}<div class="checks" style="margin-top:10px"><label><input type="checkbox" id="oC" ${o?.conv?"checked":""}> Counts as a conversation (contact rate, conversation points)</label><label><input type="checkbox" id="oA" ${o?.appt?"checked":""}> Is an appointment (sets lead status, appointment points)</label><label><input type="checkbox" id="oD" ${o?.dnc?"checked":""}> Marks the lead Do Not Call</label>${o?`<label><input type="checkbox" id="oX" ${o.disabled?"checked":""}> Disabled (hidden from the log form, history kept)</label>`:""}</div></div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="oOk">Save</button></div>`); $("#oOk").onclick=()=>{
  const name=$("#oN").value.trim(); if(!name) return;
  const v={name,conv:$("#oC").checked,appt:$("#oA").checked,dnc:$("#oD").checked};
  if(BACKEND==="supabase"){
    if(o){
      const patch={...v, disabled:$("#oX").checked};
      outcomesRepo.update(o.id, patch).then(()=>{ Object.assign(o, patch); closeDlg(); draw(); }).catch(e=>toast(e.message));
    } else {
      outcomesRepo.create(v).then(row=>{ db.outcomes.push(row); closeDlg(); draw(); }).catch(e=>toast(e.message));
    }
    return;
  }
  if(o){ Object.assign(o,v,{disabled:$("#oX").checked}); audit("updated","outcomes",name); } else { db.outcomes.push({id:nid(),...v,disabled:false}); audit("created","outcomes",name); } closeDlg(); draw(); }; }
/* ------------------------------------------------- custom field management */
export function fieldForm(id?: number){
  const f = db.customFields.find(x=>x.id===id);
  const isNew = !f;
  const taken = new Set(db.customFields.filter(x=>x.id!==id).map(x=>x.key));
  openDlg(`<div class="body"><h3>${isNew?"New field":"Edit field"}</h3>
    ${field("Field name", `<input id="fLabel" value="${esc(f?.label||"")}" placeholder="Listing price">`)}
    ${isNew ? field("Merge field name", `<input id="fKey" value="${esc((f as CustomField | undefined)?.key||"")}" placeholder="listing_price">`) + `<div class="small muted" id="fKeyMsg">Used in messages as {{your_field}} and as the spreadsheet column header. You can&apos;t change it later.</div>`
            : `<div class="alert gray small" style="margin-top:10px"><b>Merge field</b><div class="mono">{{${esc(f.key)}}}</div>This never changes, so renaming the field above won&apos;t break your campaign messages.</div>`}
    ${field("Type", `<select id="fType" onchange="fieldTypeChanged()">${opts(CF_TYPES.map(t=>[t[0],t[1]]), f?.type||"text")}</select>`)}
    <div class="small muted" id="fTypeHint"></div>
    <div id="fChoicesWrap" class="hidden">${field("Options", `<textarea id="fChoices" rows="4" placeholder="Hot&#10;Warm&#10;Cold">${esc((f?.choices||[]).join("\n"))}</textarea>`)}<div class="small muted">One per line. A value that isn&apos;t on this list is refused.</div></div>
    ${field("Help text (optional)", `<input id="fHint" value="${esc(f?.hint||"")}" placeholder="Shown under the field so the team knows what to put in it.">`)}
    <label class="small" style="display:block;margin-top:10px"><input type="checkbox" id="fTable" ${f?.inTable?"checked":""}> Show as a column in the leads table</label>
    <label class="small" style="display:block"><input type="checkbox" id="fCard" ${f?.onCard?"checked":""}> Show on campaign message cards</label>
  </div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn" id="fOk">${isNew?"Create field":"Save field"}</button></div>`);
  fieldTypeChanged();
  if(isNew){
    $("#fLabel").oninput = () => { if(!$("#fKey").dataset.touched) $("#fKey").value = keyFromLabel($("#fLabel").value); };
    $("#fKey").oninput = () => { $("#fKey").dataset.touched = "1"; $("#fKey").value = $("#fKey").value.toLowerCase().replace(/[^a-z0-9_]/g,"_"); };
  }
  $("#fOk").onclick = () => {
    const label = $("#fLabel").value.trim(); if(!label) return toast("Give the field a name");
    const key = isNew ? $("#fKey").value.trim() : f.key;
    const problem = keyProblem(key, taken); if(problem) return toast(problem);
    const type = $("#fType").value;
    const choices = type==="choice" ? [...new Set($("#fChoices").value.split("\n").map(x=>x.trim()).filter(Boolean))] : [];
    if(type==="choice" && !choices.length) return toast("A choice list needs at least one option");
    const patch = {label, type, choices, hint:$("#fHint").value.trim(), inTable:$("#fTable").checked, onCard:$("#fCard").checked};
    if(BACKEND==="supabase"){
      if(isNew){
        const order = Math.max(0, ...db.customFields.map(x=>x.order), 0) + 10;
        fieldsRepo.customCreate({key, ...patch}).then(()=>{
          db.customFields.push({id:nid(), key, active:true, order, ...patch});
          if(patch.inTable && db.settings.tableColumns.length) db.settings.tableColumns.push(key);
          if(patch.onCard && db.settings.cardFields.length) db.settings.cardFields.push(key);
          toast(`Field created. Use {{${key}}} in a campaign message.`);
          closeDlg(); draw();
        }).catch(e=>toast(e.message));
      } else {
        fieldsRepo.customUpdate(f.id, patch).then(()=>{ Object.assign(f, patch); toast("Field saved"); closeDlg(); draw(); }).catch(e=>toast(e.message));
      }
      return;
    }
    if(isNew){
      const order = Math.max(0, ...db.customFields.map(x=>x.order)) + 10;
      db.customFields.push({id:nid(), key, active:true, order, ...patch});
      audit("created","lead_custom_fields", label);
      if(patch.inTable && db.settings.tableColumns.length) db.settings.tableColumns.push(key);
      if(patch.onCard && db.settings.cardFields.length) db.settings.cardFields.push(key);
      toast(`Field created. Use {{${key}}} in a campaign message.`);
    } else { Object.assign(f, patch); audit("updated","lead_custom_fields", label); toast("Field saved"); }
    closeDlg(); draw();
  };
}
export function fieldTypeChanged(){
  const t = $("#fType")?.value; if(!t) return;
  $("#fChoicesWrap").classList.toggle("hidden", t!=="choice");
  $("#fTypeHint").textContent = (CF_TYPES.find(x=>x[0]===t)||[])[2] || "";
}
export function toggleField(id: number){
  const f=db.customFields.find(x=>x.id===id)!; const next=!f.active;
  if(BACKEND==="supabase"){
    fieldsRepo.customToggle(id, next).then(()=>{ f.active=next; toast(f.active?"Field turned on":"Field turned off — values already saved are kept"); draw(); }).catch(e=>toast(e.message));
    return;
  }
  f.active=next; audit(f.active?"turned on":"turned off","lead_custom_fields", f.label); toast(f.active?"Field turned on":"Field turned off — values already saved are kept"); draw();
}
export function moveField(id: number, dir: number){
  const fs = allFields(); const i = fs.findIndex(f=>f.id===id); const j = i+dir; if(j<0||j>=fs.length) return;
  const a = fs[i].order, b = fs[j].order;
  if(BACKEND==="supabase"){
    Promise.all([fieldsRepo.customReorder(fs[i].id, b), fieldsRepo.customReorder(fs[j].id, a)])
      .then(()=>{ fs[i].order = b; fs[j].order = a; draw(); }).catch(e=>toast(e.message));
    return;
  }
  fs[i].order = b; fs[j].order = a; draw();
}
export function deleteField(id: number){
  const f = db.customFields.find(x=>x.id===id)!;
  const n = db.leads.filter(l=>(l.custom||{})[f.key]!==undefined).length;
  confirmDlg("Delete this field?", `${f.label} and its value on ${n} lead(s) will be removed. Any campaign message using {{${f.key}}} will stop filling in. To keep the data but hide the field, use Turn off instead.`, "Delete field", ()=>{
    if(BACKEND==="supabase"){
      fieldsRepo.customDelete(id, f.key).then(()=>{
        db.leads.forEach(l=>{ if(l.custom) delete l.custom[f.key]; });
        db.customFields = db.customFields.filter(x=>x.id!==id);
        db.settings.tableColumns = db.settings.tableColumns.filter(x=>x!==f.key);
        db.settings.cardFields = db.settings.cardFields.filter(x=>x!==f.key);
        toast(n?`Field deleted, along with its value on ${n} lead(s)`:"Field deleted");
        draw();
      }).catch(e=>toast(e.message));
      return;
    }
    db.leads.forEach(l=>{ if(l.custom) delete l.custom[f.key]; });
    db.customFields = db.customFields.filter(x=>x.id!==id);
    db.settings.tableColumns = db.settings.tableColumns.filter(x=>x!==f.key);
    db.settings.cardFields = db.settings.cardFields.filter(x=>x!==f.key);
    audit("deleted","lead_custom_fields", f.label);
    toast(n?`Field deleted, along with its value on ${n} lead(s)`:"Field deleted");
    draw();
  });
}
export function saveColumns(){
  const tableColumns = [...document.querySelectorAll<HTMLInputElement>("#colPick input:checked")].map(i=>i.value);
  const cardFields = [...document.querySelectorAll<HTMLInputElement>("#cardPick input:checked")].map(i=>i.value);
  if(BACKEND==="supabase"){
    fieldsRepo.saveColumns(tableColumns, cardFields).then(()=>{ db.settings.tableColumns=tableColumns; db.settings.cardFields=cardFields; toast("Columns saved"); draw(); }).catch(e=>toast(e.message));
    return;
  }
  db.settings.tableColumns = tableColumns;
  db.settings.cardFields = cardFields;
  audit("updated","display_settings", `${db.settings.tableColumns.length} columns`);
  toast("Columns saved"); draw();
}

SET.pipelines = () => {
  if(!can("manageCrm")) return `<div class="card"><p class="small muted">Only owners and managers can change pipelines and stages.</p></div>`;
  const kindLabel: Record<string, string> = {active:"Active",closed:"Closed",lost:"Lost"};
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h4 style="margin:0">Pipelines</h4><p class="small muted" style="margin:4px 0 0">One pipeline per kind of lead. Each has its own stages and probabilities.</p></div><button class="btn" onclick="pipelineDlg()" data-testid="pipeline-new">+ New pipeline</button></div></div>
  ${db.pipelines.map(p=>`<div class="card" style="margin-top:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><b style="font-size:17px">${esc(p.name)}</b> ${p.archived?'<span class="badge">Archived</span>':""} <span class="small muted">· ${db.deals.filter(d=>d.pipelineId===p.id).length} leads</span></div>
      <div class="actions">${p.archived?`<button class="btn tint sm" onclick="restorePipeline(${p.id})">Restore</button>`:`<button class="btn tint sm" onclick="pipelineDlg(${p.id})">Rename</button><button class="btn tint sm" onclick="addStageDlg(${p.id})" data-testid="stage-add">+ Stage</button><button class="btn plain sm" onclick="archivePipeline(${p.id})">Archive</button>`}</div></div>
    <table style="margin-top:10px"><thead><tr><th>Stage</th><th>Probability</th><th>Counts as</th><th>Leads</th><th></th></tr></thead><tbody>
    ${p.stages.map(s=>`<tr style="${s.archived?"opacity:.55":""}"><td><span class="dot" style="background:${s.color};display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px"></span>${esc(s.name)}${s.archived?' <span class="badge">archived</span>':""}</td><td>${s.prob}%</td><td>${kindLabel[s.kind]}</td><td>${db.deals.filter(d=>d.pipelineId===p.id&&d.stageId===s.id).length}</td><td style="text-align:right">${s.archived?`<button class="btn plain sm" onclick="restoreStage(${p.id},${s.id})">Restore</button>`:`<button class="btn plain sm" onclick="state.crmPipe=${p.id};stageMenu(${s.id})">Edit</button>`}</td></tr>`).join("")}
    </tbody></table></div>`).join("")}`;
};

/* --------------------------------------------------------- deal profile */
