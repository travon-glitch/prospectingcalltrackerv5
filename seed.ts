import { defaultBuiltInFields } from '../core/fields.js';
import { defaultPermissions } from '../core/permissions.js';
import { audit } from '../core/session.js';
import { defaultStatuses } from '../core/statuses.js';
import { TODAY, addDays, daysAgo, isoDate } from '../core/util.js';
import { nextFu } from '../features/activity.js';
import { newPipeline, pipelines } from '../features/crm.js';
import type { CampaignLead, Deal, Lead, RawDb, RawMember, Settings } from '../types.js';

export function seed(): RawDb {
  let seq = 1000; const id = () => ++seq;
  const members: RawMember[] = [
    {id:1, name:"Travon Burnette", email:"travon@thebggroup.com", role:"owner", active:true},
    {id:2, name:"Maria Lopez", email:"maria@thebggroup.com", role:"manager", active:true},
    {id:3, name:"Devin Carter", email:"devin@thebggroup.com", role:"agent", active:true},
  ];
  const outcomes = [
    {id:1,name:"No answer",conv:false,appt:false,dnc:false,disabled:false},{id:2,name:"Left voicemail",conv:false,appt:false,dnc:false,disabled:false},
    {id:3,name:"Wrong number",conv:false,appt:false,dnc:false,disabled:false},{id:4,name:"Not interested",conv:true,appt:false,dnc:false,disabled:false},
    {id:5,name:"Interested",conv:true,appt:false,dnc:false,disabled:false},{id:6,name:"Appointment set",conv:true,appt:true,dnc:false,disabled:false},
    {id:7,name:"Call back later",conv:true,appt:false,dnc:false,disabled:false},{id:8,name:"Do not call",conv:false,appt:false,dnc:true,disabled:false},
  ];
  const lists = [{id:1,name:"Expired – Sept",archived:false,createdAt:daysAgo(20)},{id:2,name:"FSBO – Cobb",archived:false,createdAt:daysAgo(18)},{id:3,name:"Circle Prospecting",archived:false,createdAt:daysAgo(12)}];
  const L = (o: Pick<Lead, 'first' | 'last' | 'addr' | 'city' | 'zip'> & Partial<Lead>): Lead => ({ id:id(), email:"", listIds:[], phones:[], dnc:false, dnt:false, dncontact:false, archived:false, source:"import", createdAt:daysAgo(15), notesCount:0, ...o, status: o.status||"new" });
  const leads = [
    L({first:"Angela",last:"Ruiz",phones:[{n:"+14045550142",type:"mobile"},{n:"+14045550190",type:"home"}],addr:"1120 Peachtree Ln",city:"Atlanta",zip:"30309",listIds:[1],assigned:1,email:"aruiz@example.com"}),
    L({first:"Marcus",last:"Bell",phones:[{n:"+14045550177",type:"mobile"}],addr:"88 Ridge Ave",city:"Decatur",zip:"30030",listIds:[1],assigned:2,status:"contacted"}),
    L({first:"Denise",last:"Okafor",phones:[{n:"+16785550123",type:"mobile"}],addr:"4410 Oak Hollow Dr",city:"Marietta",zip:"30062",listIds:[2],assigned:3,status:"appointment"}),
    L({first:"Robert",last:"Nguyen",phones:[{n:"+17705550164",type:"mobile"}],addr:"27 Mill Creek Ct",city:"Roswell",zip:"30075",listIds:[2],assigned:1,status:"do_not_call",dnc:true}),
    L({first:"Sharon",last:"Whitfield",phones:[{n:"+14045550118",type:"home"}],addr:"301 Lenox Pointe",city:"Atlanta",zip:"30324",listIds:[3],assigned:2,status:"contacted"}),
    L({first:"Kevin",last:"Patel",phones:[{n:"+14045550155",type:"mobile"}],addr:"960 Glenwood Ave",city:"Atlanta",zip:"30316",listIds:[3],assigned:3}),
    L({first:"Latoya",last:"Green",phones:[{n:"+16785550199",type:"mobile"}],addr:"15 Powers Ferry Rd",city:"Sandy Springs",zip:"30328",listIds:[1],assigned:1,status:"attempted"}),
    L({first:"Thomas",last:"Reed",phones:[{n:"+17705550131",type:"mobile"}],addr:"720 Johnson Ferry",city:"Marietta",zip:"30068",listIds:[2],assigned:2,status:"do_not_contact",dnc:true,dnt:true,dncontact:true}),
    L({first:"Priya",last:"Shah",phones:[{n:"+14045550101",type:"mobile"}],addr:"2200 Howell Mill Rd",city:"Atlanta",zip:"30318",listIds:[3],assigned:1,status:"attempted"}),
    L({first:"William",last:"Foster",phones:[{n:"+16785550144",type:"work"}],addr:"55 Church St",city:"Decatur",zip:"30030",listIds:[1],assigned:3,dnt:true}),
    L({first:"Monica",last:"Alvarez",phones:[{n:"+14045550166",type:"mobile"}],addr:"8 Ansley Walk",city:"Atlanta",zip:"30309",listIds:[3],assigned:2,status:"contacted"}),
    L({first:"Jerome",last:"Hicks",phones:[{n:"+17705550188",type:"mobile"}],addr:"1409 Canton Rd",city:"Marietta",zip:"30066",listIds:[2],assigned:1,status:"attempted"}),
    L({first:"Brianna",last:"Cole",phones:[{n:"+14045550133",type:"mobile"}],addr:"77 Highland Ave",city:"Atlanta",zip:"30312",listIds:[1],assigned:3}),
    L({first:"Samuel",last:"Ortiz",phones:[{n:"+17705550122",type:"mobile"}],addr:"640 Roswell Rd",city:"Marietta",zip:"30062",listIds:[2],assigned:1}),
  ];
  const lid = (i: number) => leads[i].id;
  const A = (i: number, type: string, oc: number, who: number, ago: number, note="", list: number | null=null, camp: number | null=null, hour=10) => ({id:id(), leadId:lid(i), type, outcomeId:oc, userId:who, at:daysAgo(ago,hour), note, listId:list, campaignId:camp, durationMin:type==="call"?[0,1,2,3,4][ago%5]:null});
  const activities = [
    A(1,"call",7,2,1,"Asked to call back after 5pm.",1), A(1,"text",1,2,3,"",1,1), A(1,"call",1,2,5,"",1),
    A(2,"call",6,3,2,"Listing appointment Thursday 4pm.",2), A(2,"call",5,3,4,"",2),
    A(4,"call",5,2,3,"Thinking about selling in spring.",3), A(4,"call",1,2,6,"",3), A(4,"call",1,2,8,"",3), A(4,"text",1,2,9,"",3,3),
    A(8,"call",1,1,0,"",3,null,9), A(6,"call",2,1,4,"",1), A(6,"call",1,1,7,"",1),
    A(11,"door_knock",1,1,2,"Left flyer.",2), A(11,"call",1,1,3,"",2), A(11,"call",1,1,5,"",2), A(11,"call",1,1,9,"",2), A(11,"call",2,1,12,"",2),
    A(3,"call",8,1,6,"Asked not to be called again.",2), A(7,"call",4,2,9,"",2),
    A(0,"call",1,1,1,"",1), A(0,"call",2,1,2,"",1,null,11), A(12,"call",1,3,1,"",1), A(5,"call",5,3,2,"Might sell next year.",3), A(9,"call",1,3,3,"",1),
    A(13,"call",1,1,13,"",2), A(10,"call",7,2,2,"Call Monday.",3), A(10,"call",1,2,10,"",3),
  ];
  const followUps = [
    {id:id(), leadId:lid(1), due:TODAY, status:"pending", note:"Call after 5pm", assignee:2, createdAt:daysAgo(1)},
    {id:id(), leadId:lid(2), due:addDays(TODAY,3), status:"pending", note:"Listing appointment", assignee:3, createdAt:daysAgo(2)},
    {id:id(), leadId:lid(4), due:addDays(TODAY,-1), status:"pending", note:"Follow up on spring plans", assignee:2, createdAt:daysAgo(3)},
    {id:id(), leadId:lid(6), due:addDays(TODAY,1), status:"pending", note:"", assignee:1, createdAt:daysAgo(4)},
    {id:id(), leadId:lid(8), due:addDays(TODAY,2), status:"pending", note:"", assignee:1, createdAt:daysAgo(0)},
    {id:id(), leadId:lid(10), due:TODAY, status:"pending", note:"Call Monday", assignee:2, createdAt:daysAgo(2)},
  ];
  const notes = [{id:id(),leadId:lid(2),userId:3,at:daysAgo(2),text:"Wants a CMA before the appointment.",kind:"quick"},{id:id(),leadId:lid(4),userId:2,at:daysAgo(3),text:"Husband is the decision maker.",kind:"quick"},{id:id(),leadId:lid(4),userId:1,at:daysAgo(2),text:"High-value lead — coach Maria on the follow-up.",kind:"manager"}];
  const templates = [
    {id:1,name:"Expired – first touch",style:"friendly",body:"Hi {{first_name}}, this is {{agent_name}} with The BG Group. I noticed your home on {{address}} came off the market — would you be open to a quick chat about what a fresh strategy could look like?"},
    {id:2,name:"FSBO – offer help",style:"standard",body:"Hi {{first_name}}, {{agent_name}} here with The BG Group. Congrats on listing {{address}} yourself! If it'd help, I can share what buyers in {{city}} are looking for right now — no pressure."},
    {id:3,name:"Just listed – neighbours",style:"short",body:"Hi {{first_name}}, it's {{agent_name}} with The BG Group. We just listed a home near {{address}}. Know anyone in {{city}} thinking about a move?"},
    {id:4,name:"Follow-up nudge",style:"short",body:"Hi {{first_name}}, {{agent_name}} again — just checking in on {{address}}. Any questions I can answer?"},
  ];
  const campaigns = [
    {id:1,name:"Expired Listings – Sept",type:"expired_listing",body:templates[0].body,archived:false,createdAt:daysAgo(14)},
    {id:2,name:"FSBO Outreach",type:"custom",body:templates[1].body,archived:false,createdAt:daysAgo(10)},
    {id:3,name:"Just Listed – Ansley",type:"just_listed",body:templates[2].body,archived:false,createdAt:daysAgo(5)},
  ];
  const CL = (c: number, i: number, status="draft", extra: Partial<CampaignLead>={}) => ({id:id(), campaignId:c, leadId:lid(i), body:null, status, sentAt:null, sentBy:null, repliedAt:null, ...extra});
  const campaignLeads = [ CL(1,0), CL(1,1,"sent",{sentAt:daysAgo(3),sentBy:2}), CL(1,6,"ready"), CL(1,9,"draft"), CL(1,12,"draft"), CL(2,2,"replied",{sentAt:daysAgo(5),sentBy:3,repliedAt:daysAgo(4)}), CL(2,11,"draft"), CL(2,13,"draft"), CL(3,4,"sent",{sentAt:daysAgo(9),sentBy:2}), CL(3,5,"draft"), CL(3,10,"draft") ];
  const imports = [
    {id:id(),file:"expired-sept.xlsx",listId:1,rows:412,imported:398,dups:14,status:"completed",at:daysAgo(20),by:1,leadIds:[]},
    {id:id(),file:"fsbo-cobb.csv",listId:2,rows:220,imported:220,dups:0,status:"completed",at:daysAgo(18),by:1,leadIds:[]},
  ];
  const customFields = [
    {id:id(), key:"listing_price", label:"Listing price", type:"money", choices:[], hint:"What it was last listed at.", inTable:true, onCard:true, active:true, order:10},
    {id:id(), key:"expired_on", label:"Expired on", type:"date", choices:[], hint:"", inTable:false, onCard:true, active:true, order:20},
    {id:id(), key:"motivation", label:"Motivation", type:"choice", choices:["Hot","Warm","Cold"], hint:"How ready they sound.", inTable:true, onCard:false, active:true, order:30},
    {id:id(), key:"vacant", label:"Vacant", type:"yes_no", choices:[], hint:"", inTable:false, onCard:false, active:true, order:40},
  ];
  leads[0].custom = {listing_price:425000, expired_on:"2026-08-30", motivation:"Hot"};
  leads[1].custom = {listing_price:319000, motivation:"Warm"};
  leads[2].custom = {listing_price:540000, motivation:"Hot", vacant:true};
  leads[6].custom = {expired_on:"2026-09-02"};
  const settings: Settings = {
    teamName:"The BG Group", agentName:"Travon", tableColumns:[], cardFields:[],
    ptsCall:1, ptsText:1, ptsDoor:2, ptsConv:5, ptsAppt:25, weeklyGoal:250, workingDays:[1,2,3,4,5],
    permissions: defaultPermissions(),
    importCfg: { phoneSlots:10, emailSlots:1, dupPhone:true, dupEmail:true, dupAddress:true, maxRows:50000, requireName:false, requirePhone:false, flagDnc:true, defaultAssign:"", defaultList:"" },
    builtInFields: defaultBuiltInFields(),
    statuses: defaultStatuses(),
  };
  const audit = [{id:id(),at:daysAgo(20),userId:1,action:"created",table:"lists",detail:"Expired – Sept"},{id:id(),at:daysAgo(14),userId:1,action:"created",table:"campaigns",detail:"Expired Listings – Sept"},{id:id(),at:daysAgo(6),userId:1,action:"updated",table:"leads",detail:"Robert Nguyen → Do Not Call"}];
  // The CRM: one seller pipeline with a few of the leads already qualified into it.
  const pipelines = [newPipeline("Seller Leads", "seller", id), newPipeline("Probate", "probate", id)];
  const st = (n: number) => pipelines[0].stages[n];
  const D = (leadIdx: number, stageIdx: number, o: Partial<Deal> & { days?: number }) => { const l = leads[leadIdx]; const at = daysAgo(o.days ?? 3); return { id:id(), leadId:l.id, pipelineId:pipelines[0].id, stageId:st(stageIdx).id, assigned:l.assigned, temperature:"warm", commPct:3, referralPct:0, teamSplitPct:0, brokeragePct:0, brokerageFee:0, closingCosts:0, closeDate:null, nextFu:null, notes:"", createdAt:daysAgo((o.days ?? 3)+2), stageEnteredAt:at, createdBy:1, history:[{id:id(), at:daysAgo((o.days ?? 3)+2), userId:1, type:"created", detail:"Added to Seller Leads by Travon Burnette"},{id:id(), at, userId:1, type:"stage", detail:`New Lead → ${st(stageIdx).name}`}], ...o }; };
  const deals = [
    D(0, 4, {price:425000, temperature:"hot", nextFu:isoDate(new Date(Date.now()+2*86400000)), closeDate:"2026-11-15", notes:"Expired in August, wants a fresh strategy.", days:2}),
    D(1, 3, {price:319000, temperature:"warm", nextFu:isoDate(new Date(Date.now()-3*86400000)), days:9}),
    D(2, 8, {price:540000, temperature:"hot", nextFu:isoDate(new Date(Date.now()+1*86400000)), closeDate:"2026-10-30", brokeragePct:20, days:5}),
    D(4, 2, {price:280000, temperature:"cold", days:14}),
    D(5, 0, {price:350000, temperature:"warm", days:1}),
  ];
  return { seq, members, outcomes, lists, leads, activities, followUps, notes, templates, campaigns, campaignLeads, imports, settings, audit, customFields, invites:[], pipelines, deals };
}
