import type { Cap, Member } from '../types.js';

// `pretty()` below reads `me` and `can` as bare globals: this module never
// imported them (importing core/session.js here would be a cycle), it relies
// on main.ts exposing both on `window`. These ambient declarations only tell
// the type checker those globals exist — they emit nothing.
declare const me: Member | null;
declare const can: (cap: Cap) => boolean;

/**
 * querySelector shorthand. Typing convention (project-wide):
 *  - Returns T, NOT `T | null`. Every call site in the app already assumes
 *    the element exists and dereferences it immediately ($("#x").value,
 *    .onclick = ...), throwing a TypeError at runtime if it doesn't. The
 *    signature mirrors that existing "assume it exists" behavior exactly
 *    instead of forcing hundreds of `!`. Call sites that DO test the result
 *    (`if(box)`, `$("#x")?.value`) still compile and still work.
 *  - T defaults to HTMLInputElement because ~85% of call sites read
 *    .value/.checked/.disabled (and .onclick/.innerHTML/.textContent/
 *    .classList/.dataset/.focus() exist on it too). <select> and <textarea>
 *    share .value/.disabled, so the default is fine for those as well.
 *  - Pass T explicitly only when you need a member HTMLInputElement lacks:
 *    $<HTMLDialogElement>("#dlg").showModal(), $<HTMLSelectElement>("#s").options,
 *    $<HTMLFormElement>(...), $<HTMLImageElement>(...).src, etc.
 */
export const $ = <T extends HTMLElement = HTMLInputElement>(s: string, r: ParentNode = document): T => r.querySelector(s) as T;
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, c => (({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}) as Record<string, string>)[c]);
export const pad = (n: number | string): string => String(n).padStart(2,"0");
export const todayD = (): Date => { const x=new Date(); x.setHours(0,0,0,0); return x; };
export const isoDate = (x: Date): string => `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
export const TODAY = isoDate(todayD());
export const daysAgo = (n: number, h=10): string => { const x=todayD(); x.setDate(x.getDate()-n); x.setHours(h, (n*7)%60); return x.toISOString(); };
export const addDays = (s: string, n: number): string => { const x=new Date(s+"T00:00"); x.setDate(x.getDate()+n); return isoDate(x); };
export const fmtD = (s: string | null | undefined): string => s ? new Date(s.length>10 ? s : s+"T00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "—";
export const fmtDT = (s: string | null | undefined): string => s ? new Date(s).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "—";
export const digits = (s: unknown): string => String(s ?? "").replace(/\D/g,"");
export const normPhone = (s: unknown): string | null => { let d = digits(s); if (d.length===11 && d[0]==="1") d = d.slice(1); return d.length===10 ? "+1"+d : null; };
export const prettyRaw = (n: string | null | undefined): string => n ? n.replace(/^\+1(\d{3})(\d{3})(\d{4})$/,"($1) $2-$3") : "—";
export const pretty = (n: string | null | undefined): string => (!n || !me || can("viewPhones")) ? prettyRaw(n) : n.replace(/^\+1(\d{3})\d{3}(\d{4})$/,"($1) •••-$2");
export const isApple = (): boolean => /iPhone|iPad|Macintosh/.test(navigator.userAgent);
export const smsHref = (n: string, body?: string | null): string => `sms:${n}` + (body ? (isApple() ? "&" : "?") + "body=" + encodeURIComponent(body) : "");
export function toast(m: string): void { const t=$<HTMLElement & { _t?: ReturnType<typeof setTimeout> }>("#toast"); t.textContent=m; t.classList.add("show"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),2000); }
export function download(name: string, text: string, mime="text/csv"): void { const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type:mime})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }

// ---------------------------------------------------------------- permissions
/**
 * Permissions. Every role — built-in or custom — is a named set of these
 * switches. The Owner / Super Administrator role always has everything.
 * Existing features keep their old capability names; the LEGACY map turns
 * an old name into the permission that now decides it.
 */
export function copyText(t: string): void { navigator.clipboard?.writeText(t).then(()=>toast("Copied"), ()=>toast("Copy not available")); }

