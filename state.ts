import type { AppState } from '../types.js';

export let state: AppState = { view:"dashboard", id:null, q:"", status:"", assigned:"", list:"", campaign:"", dnc:"any", fu:"any", outcome:"", attMin:"", attMax:"", laFrom:"", laTo:"", sort:"name", page:0, sel:new Set(), queueIdx:0, queueList:"", actType:"call", actOutcome:null, editCustom:null, callMode:false, backTo:null, wsMore:false, wsCampaign:{}, crm:null, crmPipe:null, crmCol:0, crmDash:null, collapsed:false, setTab:"team", range:"week", auditFilter:"", fuTab:"open", importStep:null };
export const TITLES: Record<string, string> = {dashboard:"Dashboard",workspace:"Start Prospecting",leads:"Leads",lead:"Lead",followups:"Follow-Ups",lists:"Prospecting Lists",list:"Prospecting List",campaigns:"Campaign Messages",campaign:"Campaign",messages:"Campaign Messages",imports:"Imports",reports:"Team Dashboard",scoreboard:"Weekly Scoreboard",settings:"Settings",audit:"Audit log",admin:"Admin",crm:"CRM Pipeline",deal:"Deal",crmdash:"CRM Dashboard"};
/** View registry: each views/*.ts module registers `V.name = () => html`. */
export const V: Record<string, () => string> = {};
