import { field } from '../core/dialog.js';
import { isSuperAdmin, roleName } from '../core/permissions.js';
import { BACKEND, DEMO_PASSWORD, changePasswordSubmit, initials, signIn, signInWithPassword } from '../core/session.js';
import { state } from '../core/state.js';
import { $, esc } from '../core/util.js';
import { db } from '../data/persist.js';
import { badge } from '../features/activity.js';

export function loginScreen(){
  const pending = db.members.find(m=>m.id===state.pwChangeFor);
  if(pending) return `<div class="login"><div class="card"><div class="logo" style="padding-bottom:6px"><span class="mark">☎</span> Prospecting Call Tracker</div><h3 style="margin:8px 0 4px">Choose a new password</h3><p class="muted small" style="margin:0 0 14px">Hi ${esc(pending.first)}. You signed in with a temporary password, so pick your own before continuing.</p>
    ${field("New password",`<input id="npw1" type="password" autocomplete="new-password">`)}${field("Repeat it",`<input id="npw2" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter')changePasswordSubmit()">`)}
    <p class="small muted">At least 8 characters.</p><button class="btn lg" style="width:100%" onclick="changePasswordSubmit()" data-testid="change-password">Save and continue</button></div></div>`;
  // One-click demo sign-in only exists where it's explicitly turned on —
  // never in a real deployment, whichever backend is configured. Same
  // markup as the original demo when it's on; simply omitted when it's not.
  // Deploy safety: one-click demo sign-in can only ever exist on the local
  // (in-browser demo) backend. A live Supabase deployment never shows it,
  // even if VITE_DEMO_LOGIN was left on by mistake.
  const demoLoginEnabled = BACKEND === "local" && (typeof import.meta !== "undefined" && import.meta.env?.VITE_DEMO_LOGIN === "true");
  const demo = demoLoginEnabled ? db.members.filter(m=>m.active && m.demoLogin) : [];
  // Audit fix: both the top banner and the "Sample users' password is..."
  // hint below were rendering unconditionally — correct for the original
  // single-file demo (which had no such toggle to speak of), but in this
  // rebuild they're specifically about the one-click demo buttons, so they
  // should follow the same VITE_DEMO_LOGIN gate those buttons already use,
  // not leak into a real deployment that has it turned off.
  return `${demoLoginEnabled ? '<div class="banner">DEMO — sample users sign in with one click. Users created in Admin sign in below with their email and temporary password.</div>' : ""}<div class="login"><div class="card"><div class="logo" style="padding-bottom:6px"><span class="mark">☎</span> Prospecting Call Tracker</div>
    ${demoLoginEnabled ? `<p class="muted small" style="margin:0 0 14px">Pick who to sign in as, to try each role.</p>${demo.map(m=>`<button class="user-btn" onclick="signIn(${m.id})"><span class="avatar">${esc(initials(m.name))}</span><span style="flex:1"><b>${esc(m.name)}</b><div class="small muted">${esc(m.email)}</div></span><span class="badge ${isSuperAdmin(m)?"blue":""}">${esc(roleName(m))}</span></button>`).join("")}
    <hr style="border:0;border-top:1px solid var(--border);margin:14px 0">` : ""}<h4 style="margin:0 0 8px">Sign in with email</h4>
    ${field("Email",`<input id="liE" type="email" autocomplete="username" data-testid="login-email">`)}${field("Password",`<input id="liP" type="password" autocomplete="current-password" data-testid="login-password" onkeydown="if(event.key==='Enter')signInWithPassword()">`)}
    <button class="btn" style="width:100%" onclick="signInWithPassword()" data-testid="login-submit">Sign in</button><div id="liMsg" class="small" style="color:var(--danger);margin-top:8px;min-height:18px"></div>
    ${demoLoginEnabled ? `<p class="small muted" style="margin:12px 0 0">Sample users' password is <code>${DEMO_PASSWORD}</code>. In the real app this is Supabase Auth with email confirmation and password reset.</p>` : ""}</div></div>`;
}
