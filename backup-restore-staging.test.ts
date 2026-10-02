// GATE G6, item 5 (database level) — "Run backup then restore into an empty
// staging project. Compare row counts and checksums table by table."
//
// WHY THIS EXISTS AT THE POSTGRES LEVEL: on the supabase backend the app's
// own backup (supabase/functions/org-backup) is EXPORT ONLY — its header and
// src/data/persist.js:25-35 both document that an in-app restore was judged
// unsafe to build, and the restore handler refuses with "Restoring a backup
// isn't available on this backend — export only." (pinned by
// tests/certification/backup-restore-local.test.ts). The only restore path a
// real operator has is therefore an out-of-band, database-level
// backup/restore — pg_dump → empty staging project → pg_restore — and THAT
// is what this suite certifies, against a real local Postgres 16 with every
// migration in supabase/migrations/ applied, seeded at scale.
//
// Harness: same throwaway-database technique as tests/security/rls.test.ts
// (sudo -u postgres createdb, auth.uid() shim BEFORE the migrations because
// 0015_rls.sql's policies call it, migrations applied in filename order,
// node 'pg' over password auth). Skipped automatically when no local
// Postgres is reachable, exactly like rls.test.ts.
//
// Commands under test (exact):
//   backup : sudo -u postgres pg_dump -Fc --no-owner cert_g6_prod > <dump>
//   restore: sudo -u postgres createdb cert_g6_staging           (EMPTY project)
//            sudo -u postgres pg_restore --no-owner -d cert_g6_staging < <dump>
//
// Comparison, for EVERY table in schema public, computed identically on both
// sides: row count + an order-independent content checksum
//   select count(*), coalesce(md5(string_agg(h, '' order by h)), 'empty')
//   from (select md5(t::text) h from <table> t) s;
/* global console */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const PROD_DB = 'cert_g6_prod';
const STAGING_DB = 'cert_g6_staging';
const shq = (s: any) => `'${s.replace(/'/g, `'\\''`)}'`;

function pgReachable() {
  try { execSync('pg_isready -q'); return true; } catch { return false; }
}
const supabaseAvailable = pgReachable();

// Seed volumes (the certification evidence quotes these):
const N_MEMBERS = 20;
const N_TEAMS = 4;
const N_LEADS = 10000;
const N_ACTIVITIES = 50000;

describe.skipIf(!supabaseAvailable)('GATE G6.5 — pg_dump backup → EMPTY staging project → table-by-table counts + checksums', () => {
  let prod: any, staging: any;          // pg clients
  let dumpPath: any;
  let tables: any[] = [];            // every public table, discovered, not hand-listed
  let matrix: any[] = [];            // [{table, prodCount, stagCount, prodSum, stagSum}]
  let wallMs = { seed: 0, dump: 0, restore: 0, compare: 0 };

  beforeAll(async () => {
    const t0 = Date.now();
    execSync(`sudo -u postgres dropdb --if-exists ${STAGING_DB}`);
    execSync(`sudo -u postgres dropdb --if-exists ${PROD_DB}`);
    execSync(`sudo -u postgres createdb ${PROD_DB}`);
    // Shim BEFORE migrations: 0015_rls.sql's policies/helpers call
    // auth.uid(), which Supabase's platform provides and a bare Postgres
    // does not (same shim as tests/security/rls.test.ts beforeAll).
    execSync(`sudo -u postgres psql -d ${PROD_DB} -v ON_ERROR_STOP=1 -c ${shq(`create schema if not exists auth; create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid; $$;`)}`);
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    expect(files[0]).toBe('0001_extensions_and_helpers.sql');
    expect(files.at(-1)).toBe('0019_stats.sql');
    for (const f of files) execSync(`sudo -u postgres psql -d ${PROD_DB} -v ON_ERROR_STOP=1 -f ${path.join(migrationsDir, f)}`);
    // Password auth for node 'pg', same as rls.test.ts.
    execSync(`sudo -u postgres psql -v ON_ERROR_STOP=1 -c ${shq(`alter user postgres password 'vitest_test_pw';`)}`);
    prod = new pg.Client({ host: '127.0.0.1', user: 'postgres', password: 'vitest_test_pw', database: PROD_DB });
    await prod.connect();

    // ============================================================ SEED AT SCALE
    // Fixture shapes follow tests/security/rls.test.ts's proven column lists;
    // tables it doesn't cover follow their CREATE TABLE in the migrations.
    const q = (sql: any, params?: any) => prod.query(sql, params);
    const LONG_NOTE = ('Очень длинная заметка — €漢字🚀 with "double quotes", \'single\', commas,\nnewlines and =CMD() payloads; ').repeat(55); // > 5000 chars
    expect(LONG_NOTE.length).toBeGreaterThan(5000);

    await q(`insert into orgs (id, name) values (1, E'The BG Group — Üñíçødé "Prod" org\\n(G6)')`);
    await q(`select setval(pg_get_serial_sequence('orgs','id'), 1, true)`);

    // roles + role_permissions
    await q(`insert into roles (org_id, id, name, built_in, super_admin) values
      (1,'owner','Owner',true,true), (1,'manager','Administrator',true,false), (1,'agent','Inside Sales Agent',true,false)`);
    for (const [role, key, allowed] of [
      ['owner', 'export', true], ['manager', 'export', true], ['agent', 'export', false],
      ['agent', 'viewOwnLeads', true], ['agent', 'makeCalls', true], ['manager', 'viewTeamLeads', true],
    ]) await q(`insert into role_permissions (org_id, role_id, permission_key, allowed) values (1,$1,$2,$3)`, [role, key, allowed]);

    // 20 members (ids 1..20; id 1 = owner), unicode names, NULL auth_user_id
    await q(`insert into members (id, org_id, first, last, email, role_id, active, last_login)
      select g, 1, 'Mémber😀-' || g, case when g % 5 = 0 then E'O''Rourke\\n"Åberg"' else 'Pérez-' || g end,
             'member' || g || '@bg.test', case when g = 1 then 'owner' when g = 2 then 'manager' else 'agent' end,
             g <> 20, case when g % 3 = 0 then null else now() - (g || ' hours')::interval end
      from generate_series(1, ${N_MEMBERS}) g`);
    await q(`select setval(pg_get_serial_sequence('members','id'), ${N_MEMBERS}, true)`);

    // 4 teams + rosters + history + team_lists/team_campaigns/member_lists
    await q(`insert into teams (id, org_id, name, description, manager_id, archived)
      select g, 1, 'Team ' || (array['North ⛰️','South 🏖️','East','West'])[g], 'desc "' || g || E'"\\nline2', 2, g = 4
      from generate_series(1, ${N_TEAMS}) g`);
    await q(`select setval(pg_get_serial_sequence('teams','id'), ${N_TEAMS}, true)`);
    await q(`insert into team_members (org_id, team_id, member_id) select 1, ((g - 1) % ${N_TEAMS}) + 1, g from generate_series(1, ${N_MEMBERS}) g`);
    await q(`insert into team_history (org_id, team_id, member_id, joined, "left") values
      (1,1,3, now() - interval '90 days', now() - interval '30 days'),
      (1,2,3, now() - interval '30 days', null),
      (1,1,4, now() - interval '10 days', null)`);

    await q(`insert into lists (id, org_id, name, archived) values
      (1,1,E'Expired — Sept 😀',false), (2,1,'FSBO "hot" list',false), (3,1,'Old\\narchived',true)`);
    await q(`select setval(pg_get_serial_sequence('lists','id'), 3, true)`);
    await q(`insert into team_lists (org_id, team_id, list_id) values (1,1,1),(1,2,2)`);
    await q(`insert into member_lists (org_id, member_id, list_id) values (1,3,1),(1,4,1),(1,5,2)`);

    await q(`insert into statuses (org_id, key, label, tone, active, locked, "order") values
      (1,'new','New','blue',true,true,0), (1,'contacted','Contacted ✅','green',true,true,1),
      (1,'appointment',E'Appointment "set"','purple',true,true,2)`);
    await q(`insert into outcomes (id, org_id, name, conv, appt, dnc) values
      (1,1,'No answer',false,false,false), (2,1,'Conversation 🗣️',true,false,false), (3,1,E'DNC — "remove me"',false,false,true)`);
    await q(`select setval(pg_get_serial_sequence('outcomes','id'), 3, true)`);

    await q(`insert into custom_fields (org_id, key, label, type, choices, hint, in_table, on_card, "order") values
      (1,'closing_gift','Closing gift 🎁','choice', '["Bøttle of wine 🍷","\\"Smart\\" lock"]'::jsonb, 'pick one', true, true, 1),
      (1,'notes_blob','Long notes','long_text','[]'::jsonb,'',false,true,2)`);
    await q(`insert into built_in_fields (org_id, key, label, visible, required, always) values
      (1,'first','First',true,true,true), (1,'last','Last',true,false,true), (1,'phone','Phone',true,false,true)`);

    // imports first (leads.import_id FK points at it)
    await q(`insert into imports (id, org_id, file, list_id, rows, imported, dups, status, by_id) values
      (1,1,E'fsbo "sept".csv',2,9000,8800,200,'completed',2), (2,1,'bad.csv',null,10,0,0,'undone',2)`);
    await q(`select setval(pg_get_serial_sequence('imports','id'), 2, true)`);

    // -------- 10,000 leads: unicode names, long text, NULLs, awkward values
    await q(`insert into leads (id, org_id, first, last, email, addr, city, state, zip, assigned_id, status_key, dnc, dnt, dncontact, archived, source, import_id, created_at)
      select g, 1,
        'Łěád😀-' || g,
        case when g % 97 = 0 then E'O''Brien\\n"Ωmega"' else 'Pérez-' || g end,
        case when g % 5 = 0 then '' else 'lead' || g || '@example.test' end,
        case when g % 500 = 0 then repeat('Löng addr 𝒜💥 "q" ', 300) else g || E' Main St\\nUnit ' || (g % 9) end,
        case when g % 4 = 0 then 'München' else 'Atlanta' end,
        'GA', lpad((g % 100000)::text, 5, '0'),
        case when g % 7 = 0 then null else (g % ${N_MEMBERS}) + 1 end,
        (array['new','contacted','appointment'])[(g % 3) + 1],
        g % 11 = 0, g % 17 = 0, g % 23 = 0, g % 13 = 0,
        case when g % 2 = 0 then 'import' else 'manual' end,
        case when g % 2 = 0 then 1 else null end,
        now() - (g || ' minutes')::interval
      from generate_series(1, ${N_LEADS}) g`);
    await q(`select setval(pg_get_serial_sequence('leads','id'), ${N_LEADS}, true)`);

    // one normalized phone per lead ("mixed-format-but-normalized": the app
    // normalizes before storing, so every n is the same +1XXXXXXXXXX shape)
    await q(`insert into lead_phones (org_id, lead_id, n, type, "position")
      select 1, g, '+1404' || lpad((2000000 + g)::text, 7, '0'),
             (array['mobile','home','work','other'])[(g % 4) + 1], 0
      from generate_series(1, ${N_LEADS}) g`);
    await q(`insert into lead_lists (org_id, lead_id, list_id) select 1, g, (g % 2) + 1 from generate_series(1, ${N_LEADS}, 3) g`);
    await q(`insert into lead_custom_values (org_id, lead_id, field_key, value) values
      (1,1,'closing_gift','"Bøttle of wine 🍷"'::jsonb),
      (1,2,'closing_gift','"\\"Smart\\" lock"'::jsonb),
      (1,3,'notes_blob', to_jsonb($1::text)),  -- validate_lead_custom_value() caps long_text at 2000 chars; the full 5000-char value is certified via notes.text instead
      (1,4,'notes_blob', to_jsonb(E'line1\\nline2 with ''quotes'' and 💥'::text))`, [LONG_NOTE.slice(0, 1900)]);

    // templates/campaigns before activities (activities.campaign_id FK)
    await q(`insert into templates (id, org_id, name, style, body) values
      (1,1,'Intro','standard',E'Hi {{first}},\\nIt''s {{agent}} 👋'), (2,1,E'Follow "up"','casual','Re: {{addr}} — still interested?')`);
    await q(`select setval(pg_get_serial_sequence('templates','id'), 2, true)`);
    await q(`insert into campaigns (id, org_id, name, type, body, archived, duplicated_from) values
      (1,1,E'Expired Listings — Sept 🚀','custom',E'Hello {{first}} "friend",\\nline2',false,null),
      (2,1,'Expired Listings — Oct','custom','copy of sept',false,1)`);
    await q(`select setval(pg_get_serial_sequence('campaigns','id'), 2, true)`);
    await q(`insert into team_campaigns (org_id, team_id, campaign_id) values (1,1,1),(1,2,2)`); // FK to campaigns added in 0011, so seeded here, after campaigns exist
    await q(`insert into campaign_leads (org_id, campaign_id, lead_id, body, status, sent_at, sent_by, replied_at) values
      (1,1,1,'personalized 😀','sent', now() - interval '2 days', 3, null),
      (1,1,2,null,'replied', now() - interval '3 days', 3, now() - interval '1 day'),
      (1,1,3,null,'draft',null,null,null), (1,1,4,null,'ready',null,null,null), (1,2,1,null,'draft',null,null,null)`);

    // -------- 50,000 activities, one set-based INSERT ... SELECT
    await q(`insert into activities (org_id, lead_id, type, outcome_id, user_id, at, note, list_id, campaign_id, duration_min, phone)
      select 1, (g % ${N_LEADS}) + 1,
        (array['call','text','reply','door_knock'])[(g % 4) + 1],
        (g % 3) + 1, (g % ${N_MEMBERS}) + 1,
        now() - (g || ' seconds')::interval,
        case when g % 1000 = 0 then E'Spoke to the owner 😀 — said "call\\nback" o''clock' else '' end,
        case when g % 5 = 0 then 1 else null end,
        case when g % 10 = 0 then 1 else null end,
        g % 30, '+1404' || lpad((2000000 + (g % ${N_LEADS}) + 1)::text, 7, '0')
      from generate_series(1, ${N_ACTIVITIES}) g`);

    await q(`insert into follow_ups (org_id, lead_id, due, status, note, assignee_id, cancel_reason, cancelled_by, done_at) values
      (1,1,'2026-10-15','pending',E'Call back about the Üñíçødé condo 🏠',3,null,null,null),
      (1,2,'2026-10-01','done','',4,null,null, now() - interval '1 day'),
      (1,3,'2026-09-20','cancelled','lead went cold', 5, E'DNC — "remove me"', 2, null),
      (1,4,'2026-11-01','pending',$1,3,null,null,null)`, [LONG_NOTE.slice(0, 1200)]);
    await q(`insert into notes (org_id, lead_id, user_id, text, kind) values
      (1,1,3,$1,'quick'), (1,1,2,E'manager-only 👀 "note"\\nline2','manager'),
      (1,2,3,'short','quick'), (1,3,4,E'=1+1 formula-ish\\tnote','quick'), (1,4,5,'emoji 🧨🚀😀','quick')`, [LONG_NOTE]);

    await q(`insert into import_leads (org_id, import_id, lead_id) values (1,1,2),(1,1,4),(1,1,6),(1,1,8),(1,1,10)`);

    await q(`insert into pipelines (id, org_id, name, kind, archived) values (1,1,'Seller Leads 🏠','seller',false), (2,1,'Probate','probate',false)`);
    await q(`select setval(pg_get_serial_sequence('pipelines','id'), 2, true)`);
    await q(`insert into stages (id, org_id, pipeline_id, name, prob, kind, color, "position")
      select g, 1, case when g <= 3 then 1 else 2 end,
             (array['New Lead','Hot 🔥','Closed','New','Won "big"','Lost'])[g],
             (array[10,60,100,10,100,0])[g],
             (array['active','active','closed','active','closed','lost'])[g],
             '#8E8E93', ((g - 1) % 3)
      from generate_series(1, 6) g`);
    await q(`select setval(pg_get_serial_sequence('stages','id'), 6, true)`);
    await q(`insert into deals (id, org_id, lead_id, pipeline_id, stage_id, assigned_id, temperature, price, comm_pct, referral_pct, team_split_pct, brokerage_pct, brokerage_fee, closing_costs, close_date, next_fu, notes, created_by)
      select g, 1, g, 1, (g % 3) + 1, (g % ${N_MEMBERS}) + 1,
             (array['hot','warm','cold'])[(g % 3) + 1],
             100000 + g * 1111.11, 3, case when g % 2 = 0 then 25 else 0 end, 10, 20, 495, 300.50,
             case when g % 2 = 0 then '2026-11-15'::date else null end,
             case when g % 3 = 0 then '2026-10-20'::date else null end,
             E'Expired in August 😀, wants a "fresh" strategy.\\nSecond line.', 2
      from generate_series(1, 10) g`);
    await q(`select setval(pg_get_serial_sequence('deals','id'), 10, true)`);
    await q(`insert into deal_history (org_id, deal_id, user_id, type, detail)
      select 1, g, 2, case when g % 2 = 0 then 'stage' else 'created' end,
             E'New Lead → Hot 🔥 by "Travon"' from generate_series(1, 10) g`);

    await q(`insert into org_settings (org_id, team_name, agent_name, table_columns, card_fields, weekly_goal, working_days, import_cfg) values
      (1, E'The BG Group 😀 — "prod"', 'Travon', '["first","last","phone"]'::jsonb, '["price"]'::jsonb, 250,
       '[1,2,3,4,5]'::jsonb, '{"phoneSlots":10,"dupPhone":true,"note":"with ''quotes'' and 😀"}'::jsonb)`);
    await q(`insert into audit_log (org_id, user_id, action, table_name, detail) values
      (1,1,'created','lists','Expired — Sept 😀'), (1,2,'imported','imports',E'fsbo "sept".csv'),
      (1,2,'updated','leads',E'Robert Nguyen → Do Not Call\\n(bulk)'), (1,3,'exported','org_backup','Full organization backup'),
      (1,null,'signed in','auth','system')`);
    wallMs.seed = Date.now() - t0;

    // Every public table must be discovered dynamically AND be non-empty,
    // or the "compare every table" claim would be hollow.
    tables = (await q(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r: any) => r.tablename);

    // ============================================================ BACKUP (pg_dump)
    const t1 = Date.now();
    dumpPath = path.join(fs.mkdtempSync('/tmp/g6-backup-'), 'cert_g6_prod.dump');
    // Written via shell redirection so the file lands under the test user's
    // own temp dir (postgres itself can't write into a 0700 dir we own).
    execSync(`sudo -u postgres pg_dump -Fc --no-owner ${PROD_DB} > ${dumpPath}`);
    wallMs.dump = Date.now() - t1;

    // ======================================= RESTORE into an EMPTY staging project
    const t2 = Date.now();
    execSync(`sudo -u postgres createdb ${STAGING_DB}`); // empty: no migrations, nothing
    execSync(`sudo -u postgres pg_restore --no-owner -d ${STAGING_DB} < ${dumpPath}`);
    wallMs.restore = Date.now() - t2;

    staging = new pg.Client({ host: '127.0.0.1', user: 'postgres', password: 'vitest_test_pw', database: STAGING_DB });
    await staging.connect();

    // ============================================================ COMPARE
    const t3 = Date.now();
    const sumSql = (tbl: any) =>
      `select count(*)::bigint as n, coalesce(md5(string_agg(h, '' order by h)), 'empty') as sum
       from (select md5(t::text) as h from "${tbl}" t) s`;
    for (const tbl of tables) {
      const [p, s] = await Promise.all([prod.query(sumSql(tbl)), staging.query(sumSql(tbl))]);
      matrix.push({
        table: tbl,
        prodCount: Number(p.rows[0].n), stagCount: Number(s.rows[0].n),
        prodSum: p.rows[0].sum, stagSum: s.rows[0].sum,
      });
    }
    wallMs.compare = Date.now() - t3;

    console.log(
      `[G6.5 PART B] backup:  sudo -u postgres pg_dump -Fc --no-owner ${PROD_DB} > ${dumpPath}\n` +
      `[G6.5 PART B] restore: sudo -u postgres createdb ${STAGING_DB} && sudo -u postgres pg_restore --no-owner -d ${STAGING_DB} < ${dumpPath}\n` +
      `[G6.5 PART B] wall time: seed+migrate ${wallMs.seed}ms, pg_dump ${wallMs.dump}ms, pg_restore ${wallMs.restore}ms, compare ${wallMs.compare}ms\n` +
      '[G6.5 PART B] table | prod count | staging count | prod md5 | staging md5 | verdict\n' +
      matrix.map((m) =>
        `${m.table.padEnd(19)}| ${String(m.prodCount).padStart(7)} | ${String(m.stagCount).padStart(7)} | ${m.prodSum} | ${m.stagSum} | ${m.prodCount === m.stagCount && m.prodSum === m.stagSum ? 'MATCH' : 'MISMATCH'}`
      ).join('\n')
    );
  }, 120000);

  afterAll(async () => {
    if (prod) await prod.end();
    if (staging) await staging.end();
    try { execSync(`sudo -u postgres dropdb --if-exists ${PROD_DB}`); } catch { /* best effort */ }
    try { execSync(`sudo -u postgres dropdb --if-exists ${STAGING_DB}`); } catch { /* best effort */ }
    try { if (dumpPath) fs.rmSync(path.dirname(dumpPath), { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('the staging project has exactly the same set of public tables as prod', async () => {
    const stagingTables = (await staging.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r: any) => r.tablename);
    expect(stagingTables).toEqual(tables);
    expect(tables.length).toBeGreaterThanOrEqual(30); // 33 tables as of migration 0019
  });

  it('every public table was seeded non-empty in prod (so every comparison below is a real comparison)', () => {
    const empty = matrix.filter((m) => m.prodCount === 0).map((m) => m.table);
    expect(empty).toEqual([]);
  });

  it(`seeded at the certified scale: ${N_LEADS} leads, ${N_ACTIVITIES} activities, ${N_MEMBERS} members, ${N_TEAMS} teams`, () => {
    const by = Object.fromEntries(matrix.map((m) => [m.table, m.prodCount]));
    expect(by.leads).toBe(N_LEADS);
    expect(by.activities).toBe(N_ACTIVITIES);
    expect(by.members).toBe(N_MEMBERS);
    expect(by.teams).toBe(N_TEAMS);
    expect(by.lead_phones).toBe(N_LEADS);
  });

  it('row counts match prod ↔ staging for EVERY table', () => {
    for (const m of matrix) {
      expect(m.stagCount, `row count for table "${m.table}"`).toBe(m.prodCount);
    }
  });

  it('order-independent md5 content checksums match prod ↔ staging for EVERY table', () => {
    for (const m of matrix) {
      expect(m.stagSum, `content checksum for table "${m.table}"`).toBe(m.prodSum);
      expect(m.prodSum).not.toBe('empty');
    }
  });

  it('awkward values survived the round trip verbatim (emoji, embedded quotes, newlines, 5000-char note, NULLs)', async () => {
    const note = await staging.query(`select text from notes order by id limit 1`);
    expect(note.rows[0].text.length).toBeGreaterThan(5000);
    expect(note.rows[0].text).toContain('€漢字🚀');
    expect(note.rows[0].text).toContain('"double quotes"');
    expect(note.rows[0].text).toContain('\n');
    const lead97 = await staging.query(`select last, assigned_id from leads where id = 97`);
    expect(lead97.rows[0].last).toBe('O\'Brien\n"Ωmega"');
    const nulls = await staging.query(`select count(*)::int as n from leads where assigned_id is null`);
    expect(nulls.rows[0].n).toBeGreaterThan(0);
    const cfg = await staging.query(`select import_cfg from org_settings where org_id = 1`);
    expect(cfg.rows[0].import_cfg.note).toBe("with 'quotes' and 😀");
  });

  it('identity sequences survived the restore: a new lead inserted into staging gets an id above the restored max (no PK collision)', async () => {
    const max = Number((await staging.query(`select max(id)::bigint as m from leads`)).rows[0].m);
    expect(max).toBe(N_LEADS);
    const ins = await staging.query(`insert into leads (org_id, first, last, status_key) values (1, 'Post', 'Restore', 'new') returning id`);
    const newId = Number(ins.rows[0].id);
    expect(newId).toBeGreaterThan(max);
    await staging.query(`delete from leads where id = $1`, [newId]); // keep staging == prod for any later diff
  });

  it('identity sequences survived for activities too (second-largest table)', async () => {
    const max = Number((await staging.query(`select max(id)::bigint as m from activities`)).rows[0].m);
    const ins = await staging.query(`insert into activities (org_id, lead_id, type, outcome_id, user_id) values (1, 1, 'call', 1, 1) returning id`);
    const newId = Number(ins.rows[0].id);
    expect(newId).toBeGreaterThan(max);
    await staging.query(`delete from activities where id = $1`, [newId]);
  });

  it('the dump carried the RLS policies and helper functions too (restore is a full project restore, not data-only)', async () => {
    const pol = await staging.query(`select count(*)::int as n from pg_policies where schemaname = 'public'`);
    const prodPol = await prod.query(`select count(*)::int as n from pg_policies where schemaname = 'public'`);
    expect(pol.rows[0].n).toBe(prodPol.rows[0].n);
    expect(pol.rows[0].n).toBeGreaterThan(0);
    const fn = await staging.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid'`);
    expect(fn.rows[0].n).toBe(1);
  });

  it('does not touch pre-existing databases (stage10test, vitest_security_rls are outside this suite\'s lifecycle)', async () => {
    // Guard: the names this suite creates/drops are its own.
    expect(PROD_DB).not.toBe('stage10test');
    expect(STAGING_DB).not.toBe('stage10test');
    expect(PROD_DB).not.toBe('vitest_security_rls');
    expect(STAGING_DB).not.toBe('vitest_security_rls');
  });
});
