// ======================================================================
// Shared domain model. TYPE-ONLY: this file contains no runtime code, so
// every import of it must be `import type { ... } from '.../types.js'`
// (erased entirely at build time — importing it is free and can never
// create or change a module-evaluation cycle).
//
// Every shape here is derived from what the code really builds and reads:
// data/seed.ts (the local demo database), data/upgrade.ts (fields added to
// old saves), data/repo-supabase.ts's row→model mappers (the same shapes
// from real tables), and the features/views that create records.
//
// Conventions:
//  - Timestamps are ISO strings ("2026-09-01T09:00:00.000Z"); calendar
//    dates (follow-up due, deal close date) are "YYYY-MM-DD" strings.
//  - Ids are numbers everywhere except Role.id (a stable string slug).
//  - Fields starting with "_" are derived values the Supabase backend's
//    search RPCs carry on a row instead of the local backend recomputing
//    them from db.activities/db.followUps. Always optional.
//  - A field is optional only where the code really treats it as optional
//    (absent from the seed, or added later by one code path only).
// ======================================================================
import type { PERMISSIONS, LEGACY_CAP } from './core/permissions.js';

export type Backend = 'local' | 'supabase';

/** ISO timestamp string, e.g. new Date().toISOString(). */
export type IsoDateTime = string;
/** Calendar date string "YYYY-MM-DD" (core/util.ts's isoDate()). */
export type IsoDate = string;

// ---------------------------------------------------------------- permissions
/** One of the 62 permission switches — derived from core/permissions.ts's PERMISSIONS table. */
export type PermissionKey = typeof PERMISSIONS[number][0];
/** The permission groups shown in Admin → Roles ("Leads", "Prospecting", ...). */
export type PermissionGroup = typeof PERMISSIONS[number][2];
/** Old capability names still passed to can(); LEGACY_CAP maps each to a PermissionKey. */
export type LegacyCap = keyof typeof LEGACY_CAP;
/** Anything can()/canUser() accepts. */
export type Cap = PermissionKey | LegacyCap;
/** A role's full switch map: every PermissionKey present, true or false. */
export type PermMap = Record<PermissionKey, boolean>;

export interface Role {
  /** Stable slug: "owner" | "manager" | "isa_manager" | "agent" | "re_agent" | "viewer", or "r"+nid() for custom roles. */
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** Only the Owner role sets this; absent (not false) on the other seeded roles. */
  superAdmin?: boolean;
  perms: PermMap;
}

// ---------------------------------------------------------------- people
export interface Member {
  id: number;
  /** Full display name; `${first} ${last}`.trim() wherever both exist. */
  name: string;
  email: string;
  /** Role.id */
  role: string;
  active: boolean;
  // Absent on the raw seed rows; data/upgrade.ts fills every one of these
  // in before the db is ever exposed, so they are required on a live Member.
  first: string;
  last: string;
  listIds: number[];
  createdAt: IsoDateTime;
  lastLogin: IsoDateTime | null;
  /** One-click demo sign-in allowed (sample users). */
  demoLogin: boolean;
  /** Set by upgradeDb()/setPassword()/the members table; not by acceptInvite() or the local "New user" literal. */
  mustChangePw?: boolean;
  // Local backend's credential store (data/repo-local.ts).
  pwHash?: string;
  pwSalt?: string;
  pwSetAt?: IsoDateTime;
  createdBy?: number | null;
  deactivatedAt?: IsoDateTime | null;
}
/** A member row as data/seed.ts writes it / an old save holds it, before upgradeDb(). */
export type RawMember = Pick<Member, 'id' | 'name' | 'email' | 'role' | 'active'> & Partial<Member>;

export interface Team {
  id: number;
  name: string;
  description: string;
  color: string;
  /** Local: base64 data URL. Supabase: public Storage URL. */
  logo: string | null;
  managerId: number | null;
  memberIds: number[];
  listIds: number[];
  campaignIds: number[];
  archived: boolean;
  /** Stamped by archiveTeam(); never cleared on restore. */
  archivedAt?: IsoDateTime;
  createdAt: IsoDateTime;
}
export interface TeamHistoryEntry {
  userId: number;
  teamId: number;
  joined: IsoDateTime;
  left: IsoDateTime | null;
}
export interface Invite {
  id: number;
  email: string;
  /** Role.id */
  role: string;
  [extra: string]: unknown;
}

// ---------------------------------------------------------------- leads
export type PhoneType = 'mobile' | 'home' | 'work' | 'other';
export interface LeadPhone {
  /** E.164, "+1" + 10 digits (core/util.ts's normPhone()). */
  n: string;
  /** PhoneType in practice; a plain string because it round-trips through a <select> value and the lead_phones table. */
  type: string;
}
/** A cleaned custom-field value (core/fields.ts's cfClean()). */
export type CustomValue = string | number | boolean;
export type CustomValues = Record<string, CustomValue>;

export interface Lead {
  id: number;
  first: string;
  last: string;
  email: string;
  phones: LeadPhone[];
  addr: string;
  city: string;
  /** Not in the seed; only set by the lead form / imports / Supabase rows. */
  state?: string;
  zip: string;
  listIds: number[];
  /** Member.id, or null/absent when unassigned. */
  assigned?: number | null;
  /** Status.key */
  status: string;
  dnc: boolean;
  dnt: boolean;
  dncontact: boolean;
  archived: boolean;
  /** "import" | "manual" | ... */
  source: string;
  createdAt: IsoDateTime;
  notesCount?: number;
  /** Keyed by CustomField.key. Created lazily by setCustom(). */
  custom?: CustomValues;
  /** ImportJob.id, on leads an import created (local backend). */
  importId?: number;
  // Supabase search_leads() derived columns (data/repo-supabase.ts's mapSearchRow()).
  _attempts?: number;
  _lastAttemptAt?: IsoDateTime | null;
  _lastOutcomeId?: number | null;
  _nextFollowUpDue?: IsoDate | null;
  _listNamesText?: string;
  _campaignNamesText?: string;
}
/**
 * A lead as the Supabase backend's narrower fetches return it (follow-up
 * rows, campaign cards, deal cards, dashboard activity): always an id and a
 * name, plus whichever other columns that query selected. hydrateLead()
 * (features/leads.ts) merges these into db.leads additively.
 */
export type LeadPartial = Pick<Lead, 'id' | 'first' | 'last'> & Partial<Lead>;

// ---------------------------------------------------------------- activity
/** "call" | "text" | "door_knock" | "reply" */
export type ActivityType = 'call' | 'text' | 'door_knock' | 'reply';
export interface Activity {
  id: number;
  leadId: number;
  /** ActivityType in practice; string because it round-trips through state.actType / the activities table. */
  type: string;
  outcomeId: number | null;
  userId: number;
  at: IsoDateTime;
  note: string;
  listId: number | null;
  campaignId: number | null;
  durationMin: number | null;
  /** Which number was dialled/texted; absent on seed rows. */
  phone?: string | null;
}
export type FollowUpStatus = 'pending' | 'done' | 'cancelled';
export interface FollowUp {
  id: number;
  leadId: number;
  due: IsoDate;
  /** FollowUpStatus in practice. */
  status: string;
  note: string;
  /** Member.id */
  assignee: number | null;
  createdAt: IsoDateTime;
  cancelReason?: string | null;
  cancelledBy?: number | null;
  doneAt?: IsoDateTime | null;
}
export interface Note {
  id: number;
  leadId: number;
  userId: number;
  at: IsoDateTime;
  text: string;
  /** "quick" | "manager" (manager-only notes need the managerNotes permission). */
  kind: string;
}
export interface Outcome {
  id: number;
  name: string;
  /** Counts as a conversation. */
  conv: boolean;
  /** Counts as an appointment set. */
  appt: boolean;
  /** Logging it flags the lead Do Not Call. */
  dnc: boolean;
  disabled: boolean;
}
export interface Status {
  key: string;
  label: string;
  /** "" | "blue" | "green" | "orange" | "red" */
  tone: string;
  /** Absent only on statusDef()'s fallback for an unknown key. */
  active?: boolean;
  /** Built-in statuses that can't be deleted. */
  locked?: boolean;
}

// ---------------------------------------------------------------- lists & campaigns
export interface List {
  id: number;
  name: string;
  archived: boolean;
  createdAt: IsoDateTime;
}
export interface Template {
  id: number;
  name: string;
  /** "friendly" | "standard" | "short" */
  style: string;
  body: string;
}
export interface Campaign {
  id: number;
  name: string;
  /** "expired_listing" | "just_listed" | "custom" | ... (features/campaigns.ts's CAMPAIGN_TYPES) */
  type: string;
  body: string;
  archived: boolean;
  createdAt: IsoDateTime;
  duplicatedFrom?: number | null;
}
export type CampaignLeadStatus = 'draft' | 'ready' | 'sent' | 'replied';
/** One message card: one lead on one campaign. */
export interface CampaignLead {
  id: number;
  campaignId: number;
  leadId: number;
  /** null = use the campaign's template body. */
  body: string | null;
  /** CampaignLeadStatus in practice. */
  status: string;
  sentAt: IsoDateTime | null;
  sentBy: number | null;
  repliedAt: IsoDateTime | null;
  /** Supabase rows only. */
  createdAt?: IsoDateTime;
}
/** campaigns.summaries() (Supabase): per-campaign card counts + one lead to preview against. */
export interface CampaignSummary {
  total: number;
  sent: number;
  replied: number;
  sample: LeadPartial | null;
}

// ---------------------------------------------------------------- CRM
export type StageKind = 'active' | 'closed' | 'lost';
export interface Stage {
  id: number;
  name: string;
  /** Win probability, 0–100. */
  prob: number;
  /** StageKind in practice. */
  kind: string;
  color: string;
  archived: boolean;
  /** Supabase rows only (the local backend uses array order). */
  position?: number;
}
export interface Pipeline {
  id: number;
  name: string;
  /** "seller" | "probate" | ... */
  kind: string;
  stages: Stage[];
  archived: boolean;
  createdAt: IsoDateTime;
}
export interface DealHistoryEntry {
  id: number;
  at: IsoDateTime;
  userId: number;
  /** "created" | "stage" | "note" | "follow_up" | ... */
  type: string;
  detail: string;
}
export type Temperature = 'hot' | 'warm' | 'cold';
export interface Deal {
  id: number;
  leadId: number;
  pipelineId: number;
  stageId: number;
  assigned?: number | null;
  /** Temperature in practice. */
  temperature: string;
  /** Money/percent fields are numbers in the seed, but setDealField() stores whatever num()/pct() parse, and Supabase numerics may arrive as strings — always read them through num()/pct(). */
  price?: number | string | null;
  commPct: number | string;
  referralPct: number | string;
  teamSplitPct: number | string;
  brokeragePct: number | string;
  brokerageFee: number | string;
  closingCosts: number | string;
  closeDate: IsoDate | null;
  nextFu: IsoDate | null;
  notes: string;
  createdAt: IsoDateTime;
  stageEnteredAt: IsoDateTime;
  createdBy: number | null;
  history: DealHistoryEntry[];
  // Supabase search_deals() derived columns (data/repo-supabase.ts's mapDealRow()).
  _fuDue?: IsoDate | null;
  _lastContact?: IsoDateTime | null;
  _calls?: number;
  _texts?: number;
}
/** features/crm.ts's dealMath() result. */
export interface DealMath {
  price: number;
  gross: number;
  referral: number;
  brokerage: number;
  net: number;
  teamShare: number;
  agentShare: number;
  prob: number;
  weighted: number;
}
/** state.crm — the CRM board's filters (features/crm.ts's crmDefaultFilters()). All <input>/<select> values, hence strings. */
export interface CrmFilters {
  q: string; sort: string; agent: string; stage: string; temp: string; campaign: string; source: string;
  city: string; zip: string; overdue: boolean; fuFrom: string; fuTo: string;
  priceMin: string; priceMax: string; commMin: string; commMax: string;
  closeFrom: string; closeTo: string; addedFrom: string; addedTo: string; activeFrom: string;
}
/** state.crmDash — views/crmdash.ts's filters. */
export interface CrmDashFilters { pipe: string; agent: string; campaign: string; from: string; to: string; }

// ---------------------------------------------------------------- fields
export type CustomFieldType = 'text' | 'long_text' | 'number' | 'money' | 'date' | 'yes_no' | 'choice';
export interface CustomField {
  id: number;
  /** Merge-field / storage key, e.g. "listing_price". */
  key: string;
  label: string;
  /** CustomFieldType in practice; string because it round-trips through a <select> value and the custom_fields table. */
  type: string;
  choices: string[];
  hint: string;
  inTable: boolean;
  onCard: boolean;
  active: boolean;
  order: number;
}
export interface BuiltInField {
  /** "first" | "last" | "phone" | "email" | "addr" | "city" | "state" | "zip" */
  key: string;
  label: string;
  visible: boolean;
  required: boolean;
  /** Can't be hidden (first/last/phone). Absent on the others. */
  always?: boolean;
}
/** One choice in Settings → Columns (core/fields.ts's columnChoices()). */
export interface ColumnChoice { id: string; label: string; custom: boolean; }

// ---------------------------------------------------------------- imports
export interface ImportJob {
  id: number;
  file: string;
  listId: number | null;
  rows: number;
  imported: number;
  dups: number;
  /** "running" | "completed" | "undone" */
  status: string;
  at: IsoDateTime;
  /** Member.id */
  by: number;
  /** Leads this job created (local backend; always [] on Supabase). */
  leadIds: number[];
}
export interface ImportCfg {
  phoneSlots: number;
  emailSlots: number;
  dupPhone: boolean;
  dupEmail: boolean;
  dupAddress: boolean;
  maxRows: number;
  requireName: boolean;
  requirePhone: boolean;
  flagDnc: boolean;
  /** "" or a Member.id as a string (a <select> value). */
  defaultAssign: string;
  /** "" or a List.id as a string. */
  defaultList: string;
}
/** One file row after column mapping (features/imports.ts's extractRow()). */
export interface ImportRow {
  /** Spreadsheet row number (1-based, header is row 1). */
  n: number;
  first: string;
  last: string;
  phones: string[];
  email: string;
  emails: string[];
  addr: string;
  city: string;
  state: string;
  zip: string;
  note: string;
  tags: string;
  /** Raw (uncleaned) custom-field cells, keyed by CustomField.key. */
  custom: Record<string, string>;
  /** Set by the check step. */
  dnc?: boolean;
}
export interface ImportDup {
  row: ImportRow;
  match: LeadPartial;
  /** "phone" | "email" | "address + ZIP" */
  on: string;
  /** "skip" | "import" | "merge" */
  action: string;
}
/** state.importStep — the import wizard's working state. */
export interface ImportStep {
  step: 'map' | 'check';
  file: string;
  headers: string[];
  /** Raw cell grid, header row excluded. Cells are strings from CSV, anything from XLSX. */
  data: unknown[][];
  /** Per column: the field key it maps to, or "". */
  map: string[];
  /** [key, label] choices for the mapping dropdowns. */
  FIELDS: string[][];
  truncated: boolean;
  listId?: string;
  assignee?: string;
  loading?: boolean;
  ready?: ImportRow[];
  dups?: ImportDup[];
  bad?: ImportRow[];
}

// ---------------------------------------------------------------- settings & audit
export interface Settings {
  teamName: string;
  agentName: string;
  /** Column ids for the Leads table; [] = DEFAULT_COLUMNS. */
  tableColumns: string[];
  /** CustomField keys shown on message cards; [] = every onCard field. */
  cardFields: string[];
  ptsCall: number;
  ptsText: number;
  ptsDoor: number;
  ptsConv: number;
  ptsAppt: number;
  weeklyGoal: number;
  /** Day-of-week numbers, 0 = Sunday. */
  workingDays: number[];
  /** Legacy manager/agent map from old saves; superseded by db.roles (data/upgrade.ts reads it once). */
  permissions?: { manager: PermMap; agent: PermMap };
  importCfg: ImportCfg;
  builtInFields: BuiltInField[];
  statuses: Status[];
}
export interface AuditEntry {
  id: number;
  at: IsoDateTime;
  /** undefined for events logged with nobody signed in (a failed sign-in). */
  userId: number | null | undefined;
  action: string;
  table: string;
  detail: string;
}

// ---------------------------------------------------------------- the database
/** The whole in-memory database (data/persist.ts's `db`), after upgradeDb(). */
export interface Db {
  /** Last id handed out by nid(). */
  seq: number;
  members: Member[];
  roles: Role[];
  teams: Team[];
  teamHistory: TeamHistoryEntry[];
  invites: Invite[];
  outcomes: Outcome[];
  lists: List[];
  leads: Lead[];
  activities: Activity[];
  followUps: FollowUp[];
  notes: Note[];
  templates: Template[];
  campaigns: Campaign[];
  campaignLeads: CampaignLead[];
  imports: ImportJob[];
  customFields: CustomField[];
  pipelines: Pipeline[];
  deals: Deal[];
  settings: Settings;
  audit: AuditEntry[];
}
/** What seed() returns / an old save holds: a Db before upgradeDb() adds roles, teams, teamHistory and the newer Member fields. */
export type RawDb = Omit<Db, 'members' | 'roles' | 'teams' | 'teamHistory'> & {
  members: RawMember[];
  roles?: Role[];
  teams?: Team[];
  teamHistory?: TeamHistoryEntry[];
};
/** localStorage's saved blob (data/persist.ts's loadSaved()). */
export interface SavedState { db: RawDb; meId: number | null; savedAt: IsoDateTime; }

// ---------------------------------------------------------------- UI state
/** View names registered on core/state.ts's V. */
export type ViewName = string;
/**
 * core/state.ts's `state`. The first block is every key the initial literal
 * sets; the optional block is keys the app adds later by plain assignment
 * (signOut()'s reset, inline onclick handlers, dialogs).
 */
export interface AppState {
  view: ViewName;
  /** The open record (lead / list / campaign / deal id), from the URL hash. */
  id: number | null;
  // Leads filters — all raw <input>/<select> values.
  q: string; status: string; assigned: string; list: string; campaign: string;
  dnc: string; fu: string; outcome: string; attMin: string; attMax: string; laFrom: string; laTo: string;
  sort: string;
  page: number;
  /** Selected lead ids (Leads table checkboxes). */
  sel: Set<number>;
  queueIdx: number;
  /** "" or a List.id as a string. */
  queueList: string;
  /** ActivityType */
  actType: string;
  /** Outcome.id picked in the log form. */
  actOutcome: number | null;
  /** Lead.id whose custom-fields panel is in edit mode. */
  editCustom: number | null;
  callMode: boolean;
  backTo: ViewName | null;
  wsMore: boolean;
  /** Lead.id → chosen Campaign.id in the workspace's campaign panel. */
  wsCampaign: Record<number, number>;
  crm: CrmFilters | null;
  /** Pipeline.id */
  crmPipe: number | null;
  /** Mobile board: index of the visible stage column. */
  crmCol: number;
  crmDash: CrmDashFilters | null;
  collapsed: boolean;
  setTab: string;
  /** "week" | "month" | "all" */
  range: string;
  auditFilter: string;
  /** "open" | "closed" */
  fuTab: string;
  importStep: ImportStep | null;

  // ---- added after load
  /** "all" | "fresh" | "due" */
  queueMode?: string;
  /** false = show everyone's leads in the queue (needs viewAllLeads). */
  queueMine?: boolean;
  /** Member.id being forced through "Choose a new password". */
  pwChangeFor?: number | null;
  cardFilter?: string;
  cardLimit?: number;
  /** addLeadsDlg()'s ticked lead ids. */
  picked?: Set<number> | null;
  addMode?: string;
  addQ?: string;
  addList?: string;
  /** Role.id selected in Admin → Roles. */
  roleSel?: string | null;
  adminTab?: string;
  /** Permission group → expanded? */
  permOpen?: Record<string, boolean>;
  teamsArchived?: boolean;
  showFilters?: boolean;
}

// ---------------------------------------------------------------- repo results
/** signInWithPassword() result, both backends. */
export type SignInResult = { ok: true; member: Member } | { ok: false; reason: 'invalid' | 'inactive' };
/** leads.search() params (data/repo-supabase.ts) — features/leads.ts's filters plus paging. */
export interface LeadSearchParams {
  q?: string; status?: string | null; assigned?: number | string | null; list?: number | string | null; campaign?: number | string | null;
  dnc?: string; fu?: string; outcome?: number | string | null; attMin?: number | null; attMax?: number | null;
  laFrom?: string | null; laTo?: string | null; sort?: string; page?: number; pageSize?: number;
}
/** stats.member() / features/stats.ts's stats() result. */
export interface MemberStats { calls: number; texts: number; doors: number; conv: number; appts: number; rate: number; points: number; minutes: number; total: number; }

// ---------------------------------------------------------------- stats (features/stats.ts)
/** A [from, to] pair of IsoDates, inclusive (rangeFor()/weekRange()). */
export type DateRange = readonly string[];
/** campaignCounts(): texts sent / replies logged per campaign. `any` (every activity) is local-backend only. */
export interface CampaignCount { sent: number; replies: number; any?: number; }
/** callsByHour(): calls (c) and conversations (v) in one hour of the day. */
export interface HourCount { c: number; v: number; }
/** stats.crmByKind() — one row per StageKind. */
export interface CrmKindStats { n: number; price: number; gross: number; net: number; weighted: number; appt: number; listing: number; contract: number; overdue: number; overdueSample: string; }
/** stats.crmByStage() — one row per stage of one pipeline. */
export interface CrmStageStats { stageId: number; name: string; color: string; prob: number; position: number; leads: number; share: number; avgDays: number; weighted: number; }
/** stats.crmByAgent() — keyed by Member.id. */
export interface CrmAgentStats { active: number; appts: number; listings: number; closed: number; forecast: number; closedNet: number; }
