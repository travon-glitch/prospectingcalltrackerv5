// The demo's original in-browser credential store: sha256 password hashing
// with a random per-member salt, held entirely in the local `db.members`
// array (data/persist.js). This is what core/session.js's password logic
// used to be before Stage 3 split "check a password" out from "manage the
// signed-in member" — and it's still exactly what backs sign-in when
// VITE_BACKEND is "local" or unset (the safe default). Every function here
// is unchanged from the original demo; only the file it lives in is new.
import { db, _saved, persist } from './persist.js';
import type { Member, SignInResult } from '../types.js';

/** The credential fields of a Member — all setPassword()/checkPassword() touch. */
type PwFields = Partial<Pick<Member, 'pwHash' | 'pwSalt' | 'pwSetAt' | 'mustChangePw' | 'demoLogin'>>;

export const DEMO_PASSWORD = "demo1234";
export async function sha256(text: string): Promise<string> { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join(""); }
export const randomSalt = (): string => [...crypto.getRandomValues(new Uint8Array(8))].map(b=>b.toString(16).padStart(2,"0")).join("");
export async function hashPassword(pw: string, salt: string): Promise<string> { return sha256(`${salt}:${pw}`); }
export function generatePassword(): string { const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; const v=crypto.getRandomValues(new Uint8Array(10)); return [...v].map(x=>a[x%a.length]).join("") + "!"; }
export async function setPassword(m: PwFields, pw: string, {temporary=false}: { temporary?: boolean } = {}): Promise<void> { m.pwSalt = randomSalt(); m.pwHash = await hashPassword(pw, m.pwSalt); m.mustChangePw = !!temporary; m.pwSetAt = new Date().toISOString(); m.demoLogin = false; }
export async function checkPassword(m: PwFields, pw: string): Promise<boolean> { if(!m.pwHash) return false; return (await hashPassword(pw, m.pwSalt!)) === m.pwHash; }

/** Seeded members get the demo password once, so the email + password form also works for them. */
export async function ensureDemoPasswords(): Promise<void> { let changed=false; for(const m of db.members){ if(!m.pwHash){ m.pwSalt = randomSalt(); m.pwHash = await hashPassword(DEMO_PASSWORD, m.pwSalt); changed=true; } } if(changed) persist(); }

/**
 * Look up + verify credentials locally. Mirrors the original inline
 * signInWithPassword() exactly: find by email (case-insensitive), check
 * the hash, then check active — same order core/session.js's caller
 * turns into the demo's two error messages.
 */
export async function signInWithPassword(email: string, pw: string): Promise<SignInResult> {
  const m = db.members.find(x=>x.email.toLowerCase()===String(email).toLowerCase());
  if(!m || !(await checkPassword(m, pw))) return {ok:false, reason:"invalid"};
  if(!m.active) return {ok:false, reason:"inactive"};
  return {ok:true, member:m};
}

/** Nothing to do server-side for the local backend — "session" is just
 * `me` in memory plus the meId data/persist.js already saves to
 * localStorage on every persist(). core/session.js clears `me` itself. */
export async function signOut(): Promise<void> {}

/** Session restore on reload. Reads the meId data/persist.js already
 * persisted, exactly as main.js's boot sequence always has. */
export function getSessionMember(): Member | null {
  if(!_saved?.meId) return null;
  return db.members.find(m=>m.id===_saved!.meId) || null;
}

/** "Change your password" screen, local backend: just re-hash it. */
export async function updatePassword(member: PwFields, newPw: string): Promise<void> {
  await setPassword(member, newPw);
}
