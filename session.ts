// Stage 3: password checking now goes through a real credential store —
// data/repo-local.js's sha256 hashing (VITE_BACKEND=local, the default) or
// data/repo-supabase.js's real Supabase Auth (VITE_BACKEND=supabase) —
// instead of the demo's original inline sha256 calls. Everything else here
// (the signed-in member's identity `me`, permission/team helpers, the
// audit log, and the exact app-state cleanup on sign-out) is unchanged
// from Stage 0 and still keyed off the local in-memory `db`
// (data/persist.js): only *authentication* moves to Supabase in this
// stage. The rest of the data layer — including which local `db.members`
// row a Supabase-authenticated person actually is — is later stages' work.
import { can, isSuperAdmin } from './permissions.js';
import { go } from './router.js';
import { state } from './state.js';
import { $, toast } from './util.js';
import { db, nid, persist } from '../data/persist.js';
import { outcome } from '../features/activity.js';
import { draw } from '../main.js';
import * as repoLocal from '../data/repo-local.js';
import { repoSupabase, writeAuditLog } from '../data/repo-supabase.js';
import type { Backend, Member, Team } from '../types.js';

/**
 * Which credential store backs sign-in, read once at module load. Vite
 * replaces `import.meta.env.VITE_*` at build time; the guard/default keep
 * this file safe to load even without Vite, where it just behaves like the
 * original demo always did (local, sha256-hashed, no network calls).
 */
export const BACKEND: Backend = (typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKEND === "supabase") ? "supabase" : "local";
const repo = BACKEND === "supabase" ? repoSupabase : repoLocal;

// Local-only credential helpers other modules still use directly —
// admin.js's user/password management (resetPasswordDlg, userDlg, ...) is
// Stage 12's job to wire to Supabase, so it keeps reading these from here,
// unchanged, exactly as it did in Stage 0.
export const { DEMO_PASSWORD, sha256, randomSalt, hashPassword, generatePassword, setPassword, checkPassword, ensureDemoPasswords } = repoLocal;

export let me: Member | null = null;
/**
 * Module-boundary setter for `me`. Not in the original monolith: there, every
 * function shared one global scope and could reassign `me` directly. Once split
 * into ES modules, only this module may reassign its own exported `let me`, so
 * data/persist.js (restoring a backup) and main.js (restoring the last signed-in
 * user on load) call this instead of assigning `me` themselves. Behavior is
 * identical to the original inline `me = ...` assignments.
 */
export function setMe(m: Member | null): void { me = m; }
/** Role shorthand. Feature access goes through can(), not this. */
export const isMgr = (): boolean | null => me && (isSuperAdmin(me) || can("viewTeamLeads"));
export const memberName = (id: number | null | undefined): string => db.members.find(m=>m.id===id)?.name ?? "—";
/** Lead statuses come from Settings, so a team can rename or add their own. */
export function audit(action: string, table: string, detail: string): void {
  db.audit.unshift({id:nid(), at:new Date().toISOString(), userId:me?.id, action, table, detail});
  // Stage 13: this single function is every mutation path's one audit-log
  // call site (dozens of them, across leads.js/crm.js/admin.js/settings.js/
  // campaigns.js/...), so wiring real persistence in here — instead of
  // touching every call site individually — retroactively gives every one
  // of them a real audit_log row too. Fire-and-forget: the local db.audit
  // entry above already updated the UI instantly, so nothing here should
  // make the calling action wait on a network round trip.
  // Audit fix: writeAuditLog() is async and was neither awaited nor
  // caught here — any rejection (a dropped network call, an expired
  // session when supabase.auth.getUser() is checked) surfaced as an
  // unhandled promise rejection on every single mutation across the app
  // (this one function is the audit call site for leads/crm/admin/
  // settings/campaigns/...). It's already explicitly fire-and-forget by
  // design (see writeAuditLog's own comment); catching here just keeps a
  // failed audit-log write from throwing outside the write it was logging.
  if(BACKEND==="supabase") writeAuditLog(action, table, detail, me?.id).catch(e => console.error("audit log:", e.message || e));
}

// ---------------------------------------------------------------- derived helpers
export function signOut(): void {
  persist();
  // Fire-and-forget: the app resets its own state immediately, exactly as
  // fast as the original demo did, rather than making the person wait on
  // a network round trip just to see the login screen again. For the
  // local backend this is a no-op anyway (repo-local.js's signOut()).
  repo.signOut?.();
  // A different person shouldn't inherit the last one's search, filters or queue.
  me=null; state.sel.clear();
  Object.assign(state, {q:"", status:"", assigned:"", list:"", campaign:"", dnc:"any", fu:"any", outcome:"", attMin:"", attMax:"", laFrom:"", laTo:"", page:0,
    queueIdx:0, queueList:"", queueMode:"all", queueMine:true, callMode:false, backTo:null, wsMore:false, wsCampaign:{}, crm:null, crmPipe:null, crmCol:0, crmDash:null, editCustom:null, setTab:"team", cardFilter:"all", fuTab:"open"});
  location.hash=""; draw();
}
export const initials = (name: string | null | undefined): string => (name||"?").split(" ").filter(Boolean).map(x=>x[0]).join("").slice(0,2).toUpperCase();
export const teamsOf = (id: number | null | undefined): Team[] => db.teams.filter(t=>!t.archived && t.memberIds.includes(id as number));

/**
 * Finishes signing someone in once their credentials have already been
 * checked — by whichever repo did the checking. Exactly the original
 * demo's signIn(id) body, just no longer doing its own lookup-by-id first
 * (the caller already has the member).
 */
function finishSignIn(m: Member): void {
  setMe(m); m.lastLogin=new Date().toISOString(); audit("signed in","auth",me!.name); state.sel.clear(); state.queueIdx=0;
  if(m.mustChangePw){ state.pwChangeFor=m.id; setMe(null); draw(); return; }
  go(location.hash.slice(1).split("/")[0]||"dashboard");
}

/**
 * The one-click "pick who to sign in as" buttons (views/login.js, gated
 * there behind VITE_DEMO_LOGIN). Local backend: the same trusted bypass
 * the demo always used, no password involved. Supabase backend: there's
 * no bypassing real auth, so this signs in for real with the known demo
 * password — the same one ensureDemoPasswords() keeps every seed member's
 * *local* hash in sync with. (Making that password actually work against
 * a real Supabase Auth user is a seeding/ops concern, not app code — see
 * .env.example.)
 */
export async function signIn(id: number): Promise<void> {
  const m=db.members.find(x=>x.id===id); if(!m || !m.active) return;
  if(BACKEND === "local"){ finishSignIn(m); return; }
  // Deploy safety: on a live backend there is no demo sign-in at all. It used
  // to try the well-known demo password against real auth; now it refuses,
  // so a live login can only ever come from the email + password form.
  toast("Demo sign-in isn't available here. Sign in with your email and password.");
}

/** The email + password form. Error copy is the exact demo text either
 * way — repo.signInWithPassword() never reveals which of email/password
 * was wrong, matching the original inline check exactly. */
export async function signInWithPassword(): Promise<void> {
  const email=$("#liE").value.trim().toLowerCase(), pw=$("#liP").value; const msg=$("#liMsg");
  const result = await repo.signInWithPassword(email, pw);
  if(!result.ok){
    if(result.reason === "inactive"){ msg.textContent="This account has been deactivated. Ask an administrator."; return; }
    msg.textContent="Wrong email or password."; audit("failed sign-in","auth",email); return;
  }
  finishSignIn(result.member);
}

export async function changePasswordSubmit(): Promise<void> {
  const m=db.members.find(x=>x.id===state.pwChangeFor)!; const a=$("#npw1").value, b=$("#npw2").value;
  if(a.length<8) return toast("At least 8 characters");
  if(a!==b) return toast("The two passwords don't match");
  // Only the local backend can cheaply check "is this the same password
  // you already have" without a second real sign-in call — see
  // repo-supabase.js's updatePassword() for why that check is skipped there.
  if(BACKEND === "local" && await checkPassword(m,a)) return toast("Choose a different password from the temporary one");
  await repo.updatePassword(m, a);
  m.mustChangePw=false; state.pwChangeFor=null; audit("changed password","auth",m.name); setMe(m); toast("Password saved"); go("dashboard");
}

/**
 * Session restore on reload. Local backend: unchanged from Stage 0 —
 * main.js reads data/persist.js's own `_saved.meId` directly and
 * synchronously; this function isn't even called on that path. Supabase
 * backend: ask Supabase who's signed in (it persists its own session per
 * its client defaults) and resolve that back to the matching local member.
 */
export async function restoreSession(): Promise<void> {
  if(BACKEND !== "supabase") return;
  const m = await repo.getSessionMember();
  if(m) setMe(m);
}
