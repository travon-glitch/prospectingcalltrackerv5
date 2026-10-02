import { $, esc } from './util.js';
import { db } from '../data/persist.js';

export function openDlg(html: string, {wide=false, onOpen}: { wide?: boolean; onOpen?: (d: HTMLDialogElement) => void } = {}): void { const d=$<HTMLDialogElement>("#dlg"); d.className = wide?"wide":""; d.innerHTML=html; if(!d.open) d.showModal(); onOpen && onOpen(d); }
export function closeDlg(): void { $<HTMLDialogElement>("#dlg").close(); }
$("#dlg").addEventListener("click", (e)=>{ if((e.target as HTMLElement).id==="dlg") closeDlg(); });
export function confirmDlg(title: string, msg: string, label: string, fn: () => void, danger=true): void { openDlg(`<div class="body"><h3>${esc(title)}</h3><div class="muted">${esc(msg)}</div></div><div class="foot"><button class="btn plain" onclick="closeDlg()">Cancel</button><button class="btn ${danger?'danger':''}" id="cYes" data-testid="confirm-action">${esc(label)}</button></div>`); $("#cYes").onclick=()=>{ closeDlg(); fn(); }; }
/** A labelled control. Wrapped so a label and its input stay in one grid cell. */
export const field = (label: string, inner: string): string => `<div class="fld"><label class="f">${label}</label>${inner}</div>`;
export const opts = (arr: readonly (readonly unknown[])[], sel?: unknown, blank?: string): string => (blank!==undefined?`<option value="">${blank}</option>`:"") + arr.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(sel)?"selected":""}>${esc(t)}</option>`).join("");
export const memberOpts = (sel?: unknown, blank?: string): string => opts(db.members.filter(m=>m.active).map(m=>[m.id,m.name]), sel, blank);
export const listOpts = (sel?: unknown, blank?: string): string => opts(db.lists.filter(l=>!l.archived).map(l=>[l.id,l.name]), sel, blank);

// ---------------------------------------------------------------- filtering
