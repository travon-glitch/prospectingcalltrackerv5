-- supabase/seed.sql
-- Reproduces data/seed.js's seed() exactly: 3 members, 8 outcomes, 3 lists,
-- 14 leads (15 phones, 9 custom values, 14 list memberships), 27 activities,
-- 6 follow-ups, 3 notes, 4 templates, 3 campaigns, 11 campaign_leads, 2 imports,
-- 4 custom fields, 2 pipelines x 14 stages, 5 deals with 10 deal_history rows,
-- the 6 default roles with their full 62-permission grants (parsed
-- straight from core/permissions.js, not hand-transcribed), 1 team, and org
-- settings. Row data itself comes from a real run of seed()'s own logic, so
-- every value matches the demo exactly (see docs/schema.md for how).

begin;

-- Org
insert into orgs (id, name) values (1, 'The BG Group');

-- Roles (defaultRoles() in core/permissions.js)
insert into roles (org_id, id, name, description, built_in, super_admin) values
  (1, 'owner', 'Owner / Super Administrator', 'Complete control over the platform, including administrators, roles and system settings.', true, true),
  (1, 'manager', 'Administrator', 'Creates and manages users, assigns leads and lists, manages campaigns, CRM stages and competitions, exports data.', true, false),
  (1, 'isa_manager', 'Inside Sales Manager', 'Coaches the callers: assigns leads, reviews calls, texts and notes, monitors follow-ups and runs competitions — without system-administrator access.', true, false),
  (1, 'agent', 'Inside Sales Agent', 'Works assigned leads: calls, texts, notes, follow-ups, outcomes, moves their leads through the CRM.', true, false),
  (1, 're_agent', 'Real Estate Agent', 'Works assigned leads and their own CRM opportunities.', true, false),
  (1, 'viewer', 'Viewer / Coach', 'Reads dashboards, reports and activity. Cannot edit, delete or reassign anything.', true, false);

-- Role permissions: one row per (role, permission key) for all 62 keys
-- in the PERMISSIONS catalog (ALL_PERMS()/permsFrom() semantics).
insert into role_permissions (org_id, role_id, permission_key, allowed) values
  (1, 'owner', 'viewOwnLeads', true),
  (1, 'owner', 'viewTeamLeads', true),
  (1, 'owner', 'viewAllLeads', true),
  (1, 'owner', 'createLeads', true),
  (1, 'owner', 'editLeads', true),
  (1, 'owner', 'deleteLeads', true),
  (1, 'owner', 'assignLeads', true),
  (1, 'owner', 'reassign', true),
  (1, 'owner', 'export', true),
  (1, 'owner', 'import', true),
  (1, 'owner', 'manageLists', true),
  (1, 'owner', 'editDnc', true),
  (1, 'owner', 'makeCalls', true),
  (1, 'owner', 'sendTexts', true),
  (1, 'owner', 'addNotes', true),
  (1, 'owner', 'createFollowUps', true),
  (1, 'owner', 'editOutcomes', true),
  (1, 'owner', 'viewAttempts', true),
  (1, 'owner', 'browserDialer', true),
  (1, 'owner', 'viewPhones', true),
  (1, 'owner', 'markSent', true),
  (1, 'owner', 'managerNotes', true),
  (1, 'owner', 'viewOwnPipeline', true),
  (1, 'owner', 'viewTeamPipeline', true),
  (1, 'owner', 'viewAllPipelines', true),
  (1, 'owner', 'moveStages', true),
  (1, 'owner', 'manageCrm', true),
  (1, 'owner', 'viewPrices', true),
  (1, 'owner', 'viewCommissions', true),
  (1, 'owner', 'editDealFinancials', true),
  (1, 'owner', 'exportCrm', true),
  (1, 'owner', 'manageCampaigns', true),
  (1, 'owner', 'editCampaigns', true),
  (1, 'owner', 'deleteCampaigns', true),
  (1, 'owner', 'assignCampaigns', true),
  (1, 'owner', 'createTemplates', true),
  (1, 'owner', 'creativeMessages', true),
  (1, 'owner', 'viewTeamMembers', true),
  (1, 'owner', 'createTeams', true),
  (1, 'owner', 'editTeams', true),
  (1, 'owner', 'assignMembers', true),
  (1, 'owner', 'assignManagers', true),
  (1, 'owner', 'viewTeamReports', true),
  (1, 'owner', 'viewCompetitions', true),
  (1, 'owner', 'participate', true),
  (1, 'owner', 'createCompetitions', true),
  (1, 'owner', 'editCompetitions', true),
  (1, 'owner', 'manageScoring', true),
  (1, 'owner', 'viewAllResults', true),
  (1, 'owner', 'createUsers', true),
  (1, 'owner', 'editUsers', true),
  (1, 'owner', 'deactivateUsers', true),
  (1, 'owner', 'resetPasswords', true),
  (1, 'owner', 'createRoles', true),
  (1, 'owner', 'editPermissions', true),
  (1, 'owner', 'manageIntegrations', true),
  (1, 'owner', 'viewAudit', true),
  (1, 'owner', 'exportReports', true),
  (1, 'owner', 'manageSettings', true),
  (1, 'owner', 'manageOutcomes', true),
  (1, 'owner', 'manageFields', true),
  (1, 'owner', 'manageStatuses', true),
  (1, 'manager', 'viewOwnLeads', true),
  (1, 'manager', 'viewTeamLeads', true),
  (1, 'manager', 'viewAllLeads', true),
  (1, 'manager', 'createLeads', true),
  (1, 'manager', 'editLeads', true),
  (1, 'manager', 'deleteLeads', true),
  (1, 'manager', 'assignLeads', true),
  (1, 'manager', 'reassign', true),
  (1, 'manager', 'export', true),
  (1, 'manager', 'import', true),
  (1, 'manager', 'manageLists', true),
  (1, 'manager', 'editDnc', true),
  (1, 'manager', 'makeCalls', true),
  (1, 'manager', 'sendTexts', true),
  (1, 'manager', 'addNotes', true),
  (1, 'manager', 'createFollowUps', true),
  (1, 'manager', 'editOutcomes', true),
  (1, 'manager', 'viewAttempts', true),
  (1, 'manager', 'browserDialer', true),
  (1, 'manager', 'viewPhones', true),
  (1, 'manager', 'markSent', true),
  (1, 'manager', 'managerNotes', true),
  (1, 'manager', 'viewOwnPipeline', true),
  (1, 'manager', 'viewTeamPipeline', true),
  (1, 'manager', 'viewAllPipelines', true),
  (1, 'manager', 'moveStages', true),
  (1, 'manager', 'manageCrm', true),
  (1, 'manager', 'viewPrices', true),
  (1, 'manager', 'viewCommissions', true),
  (1, 'manager', 'editDealFinancials', true),
  (1, 'manager', 'exportCrm', true),
  (1, 'manager', 'manageCampaigns', true),
  (1, 'manager', 'editCampaigns', true),
  (1, 'manager', 'deleteCampaigns', true),
  (1, 'manager', 'assignCampaigns', true),
  (1, 'manager', 'createTemplates', true),
  (1, 'manager', 'creativeMessages', true),
  (1, 'manager', 'viewTeamMembers', true),
  (1, 'manager', 'createTeams', true),
  (1, 'manager', 'editTeams', true),
  (1, 'manager', 'assignMembers', true),
  (1, 'manager', 'assignManagers', true),
  (1, 'manager', 'viewTeamReports', true),
  (1, 'manager', 'viewCompetitions', true),
  (1, 'manager', 'participate', true),
  (1, 'manager', 'createCompetitions', true),
  (1, 'manager', 'editCompetitions', true),
  (1, 'manager', 'manageScoring', true),
  (1, 'manager', 'viewAllResults', true),
  (1, 'manager', 'createUsers', true),
  (1, 'manager', 'editUsers', true),
  (1, 'manager', 'deactivateUsers', true),
  (1, 'manager', 'resetPasswords', true),
  (1, 'manager', 'createRoles', false),
  (1, 'manager', 'editPermissions', false),
  (1, 'manager', 'manageIntegrations', false),
  (1, 'manager', 'viewAudit', true),
  (1, 'manager', 'exportReports', true),
  (1, 'manager', 'manageSettings', true),
  (1, 'manager', 'manageOutcomes', true),
  (1, 'manager', 'manageFields', true),
  (1, 'manager', 'manageStatuses', true),
  (1, 'isa_manager', 'viewOwnLeads', true),
  (1, 'isa_manager', 'viewTeamLeads', true),
  (1, 'isa_manager', 'viewAllLeads', false),
  (1, 'isa_manager', 'createLeads', true),
  (1, 'isa_manager', 'editLeads', true),
  (1, 'isa_manager', 'deleteLeads', false),
  (1, 'isa_manager', 'assignLeads', true),
  (1, 'isa_manager', 'reassign', true),
  (1, 'isa_manager', 'export', true),
  (1, 'isa_manager', 'import', true),
  (1, 'isa_manager', 'manageLists', true),
  (1, 'isa_manager', 'editDnc', true),
  (1, 'isa_manager', 'makeCalls', true),
  (1, 'isa_manager', 'sendTexts', true),
  (1, 'isa_manager', 'addNotes', true),
  (1, 'isa_manager', 'createFollowUps', true),
  (1, 'isa_manager', 'editOutcomes', true),
  (1, 'isa_manager', 'viewAttempts', true),
  (1, 'isa_manager', 'browserDialer', true),
  (1, 'isa_manager', 'viewPhones', true),
  (1, 'isa_manager', 'markSent', true),
  (1, 'isa_manager', 'managerNotes', true),
  (1, 'isa_manager', 'viewOwnPipeline', true),
  (1, 'isa_manager', 'viewTeamPipeline', true),
  (1, 'isa_manager', 'viewAllPipelines', false),
  (1, 'isa_manager', 'moveStages', true),
  (1, 'isa_manager', 'manageCrm', false),
  (1, 'isa_manager', 'viewPrices', true),
  (1, 'isa_manager', 'viewCommissions', true),
  (1, 'isa_manager', 'editDealFinancials', true),
  (1, 'isa_manager', 'exportCrm', true),
  (1, 'isa_manager', 'manageCampaigns', true),
  (1, 'isa_manager', 'editCampaigns', true),
  (1, 'isa_manager', 'deleteCampaigns', false),
  (1, 'isa_manager', 'assignCampaigns', true),
  (1, 'isa_manager', 'createTemplates', true),
  (1, 'isa_manager', 'creativeMessages', true),
  (1, 'isa_manager', 'viewTeamMembers', true),
  (1, 'isa_manager', 'createTeams', false),
  (1, 'isa_manager', 'editTeams', false),
  (1, 'isa_manager', 'assignMembers', true),
  (1, 'isa_manager', 'assignManagers', false),
  (1, 'isa_manager', 'viewTeamReports', true),
  (1, 'isa_manager', 'viewCompetitions', true),
  (1, 'isa_manager', 'participate', true),
  (1, 'isa_manager', 'createCompetitions', true),
  (1, 'isa_manager', 'editCompetitions', true),
  (1, 'isa_manager', 'manageScoring', true),
  (1, 'isa_manager', 'viewAllResults', true),
  (1, 'isa_manager', 'createUsers', false),
  (1, 'isa_manager', 'editUsers', false),
  (1, 'isa_manager', 'deactivateUsers', false),
  (1, 'isa_manager', 'resetPasswords', false),
  (1, 'isa_manager', 'createRoles', false),
  (1, 'isa_manager', 'editPermissions', false),
  (1, 'isa_manager', 'manageIntegrations', false),
  (1, 'isa_manager', 'viewAudit', false),
  (1, 'isa_manager', 'exportReports', true),
  (1, 'isa_manager', 'manageSettings', false),
  (1, 'isa_manager', 'manageOutcomes', false),
  (1, 'isa_manager', 'manageFields', false),
  (1, 'isa_manager', 'manageStatuses', false),
  (1, 'agent', 'viewOwnLeads', true),
  (1, 'agent', 'viewTeamLeads', false),
  (1, 'agent', 'viewAllLeads', false),
  (1, 'agent', 'createLeads', true),
  (1, 'agent', 'editLeads', true),
  (1, 'agent', 'deleteLeads', false),
  (1, 'agent', 'assignLeads', false),
  (1, 'agent', 'reassign', false),
  (1, 'agent', 'export', true),
  (1, 'agent', 'import', false),
  (1, 'agent', 'manageLists', false),
  (1, 'agent', 'editDnc', false),
  (1, 'agent', 'makeCalls', true),
  (1, 'agent', 'sendTexts', true),
  (1, 'agent', 'addNotes', true),
  (1, 'agent', 'createFollowUps', true),
  (1, 'agent', 'editOutcomes', true),
  (1, 'agent', 'viewAttempts', true),
  (1, 'agent', 'browserDialer', true),
  (1, 'agent', 'viewPhones', true),
  (1, 'agent', 'markSent', true),
  (1, 'agent', 'managerNotes', false),
  (1, 'agent', 'viewOwnPipeline', true),
  (1, 'agent', 'viewTeamPipeline', false),
  (1, 'agent', 'viewAllPipelines', false),
  (1, 'agent', 'moveStages', true),
  (1, 'agent', 'manageCrm', false),
  (1, 'agent', 'viewPrices', true),
  (1, 'agent', 'viewCommissions', false),
  (1, 'agent', 'editDealFinancials', false),
  (1, 'agent', 'exportCrm', false),
  (1, 'agent', 'manageCampaigns', false),
  (1, 'agent', 'editCampaigns', false),
  (1, 'agent', 'deleteCampaigns', false),
  (1, 'agent', 'assignCampaigns', false),
  (1, 'agent', 'createTemplates', false),
  (1, 'agent', 'creativeMessages', false),
  (1, 'agent', 'viewTeamMembers', true),
  (1, 'agent', 'createTeams', false),
  (1, 'agent', 'editTeams', false),
  (1, 'agent', 'assignMembers', false),
  (1, 'agent', 'assignManagers', false),
  (1, 'agent', 'viewTeamReports', false),
  (1, 'agent', 'viewCompetitions', true),
  (1, 'agent', 'participate', true),
  (1, 'agent', 'createCompetitions', false),
  (1, 'agent', 'editCompetitions', false),
  (1, 'agent', 'manageScoring', false),
  (1, 'agent', 'viewAllResults', false),
  (1, 'agent', 'createUsers', false),
  (1, 'agent', 'editUsers', false),
  (1, 'agent', 'deactivateUsers', false),
  (1, 'agent', 'resetPasswords', false),
  (1, 'agent', 'createRoles', false),
  (1, 'agent', 'editPermissions', false),
  (1, 'agent', 'manageIntegrations', false),
  (1, 'agent', 'viewAudit', false),
  (1, 'agent', 'exportReports', false),
  (1, 'agent', 'manageSettings', false),
  (1, 'agent', 'manageOutcomes', false),
  (1, 'agent', 'manageFields', false),
  (1, 'agent', 'manageStatuses', false),
  (1, 're_agent', 'viewOwnLeads', true),
  (1, 're_agent', 'viewTeamLeads', false),
  (1, 're_agent', 'viewAllLeads', false),
  (1, 're_agent', 'createLeads', true),
  (1, 're_agent', 'editLeads', true),
  (1, 're_agent', 'deleteLeads', false),
  (1, 're_agent', 'assignLeads', false),
  (1, 're_agent', 'reassign', false),
  (1, 're_agent', 'export', true),
  (1, 're_agent', 'import', false),
  (1, 're_agent', 'manageLists', false),
  (1, 're_agent', 'editDnc', false),
  (1, 're_agent', 'makeCalls', true),
  (1, 're_agent', 'sendTexts', true),
  (1, 're_agent', 'addNotes', true),
  (1, 're_agent', 'createFollowUps', true),
  (1, 're_agent', 'editOutcomes', true),
  (1, 're_agent', 'viewAttempts', true),
  (1, 're_agent', 'browserDialer', true),
  (1, 're_agent', 'viewPhones', true),
  (1, 're_agent', 'markSent', true),
  (1, 're_agent', 'managerNotes', false),
  (1, 're_agent', 'viewOwnPipeline', true),
  (1, 're_agent', 'viewTeamPipeline', false),
  (1, 're_agent', 'viewAllPipelines', false),
  (1, 're_agent', 'moveStages', true),
  (1, 're_agent', 'manageCrm', false),
  (1, 're_agent', 'viewPrices', true),
  (1, 're_agent', 'viewCommissions', true),
  (1, 're_agent', 'editDealFinancials', false),
  (1, 're_agent', 'exportCrm', false),
  (1, 're_agent', 'manageCampaigns', false),
  (1, 're_agent', 'editCampaigns', false),
  (1, 're_agent', 'deleteCampaigns', false),
  (1, 're_agent', 'assignCampaigns', false),
  (1, 're_agent', 'createTemplates', false),
  (1, 're_agent', 'creativeMessages', false),
  (1, 're_agent', 'viewTeamMembers', true),
  (1, 're_agent', 'createTeams', false),
  (1, 're_agent', 'editTeams', false),
  (1, 're_agent', 'assignMembers', false),
  (1, 're_agent', 'assignManagers', false),
  (1, 're_agent', 'viewTeamReports', false),
  (1, 're_agent', 'viewCompetitions', true),
  (1, 're_agent', 'participate', true),
  (1, 're_agent', 'createCompetitions', false),
  (1, 're_agent', 'editCompetitions', false),
  (1, 're_agent', 'manageScoring', false),
  (1, 're_agent', 'viewAllResults', false),
  (1, 're_agent', 'createUsers', false),
  (1, 're_agent', 'editUsers', false),
  (1, 're_agent', 'deactivateUsers', false),
  (1, 're_agent', 'resetPasswords', false),
  (1, 're_agent', 'createRoles', false),
  (1, 're_agent', 'editPermissions', false),
  (1, 're_agent', 'manageIntegrations', false),
  (1, 're_agent', 'viewAudit', false),
  (1, 're_agent', 'exportReports', false),
  (1, 're_agent', 'manageSettings', false),
  (1, 're_agent', 'manageOutcomes', false),
  (1, 're_agent', 'manageFields', false),
  (1, 're_agent', 'manageStatuses', false),
  (1, 'viewer', 'viewOwnLeads', true),
  (1, 'viewer', 'viewTeamLeads', true),
  (1, 'viewer', 'viewAllLeads', false),
  (1, 'viewer', 'createLeads', false),
  (1, 'viewer', 'editLeads', false),
  (1, 'viewer', 'deleteLeads', false),
  (1, 'viewer', 'assignLeads', false),
  (1, 'viewer', 'reassign', false),
  (1, 'viewer', 'export', false),
  (1, 'viewer', 'import', false),
  (1, 'viewer', 'manageLists', false),
  (1, 'viewer', 'editDnc', false),
  (1, 'viewer', 'makeCalls', false),
  (1, 'viewer', 'sendTexts', false),
  (1, 'viewer', 'addNotes', false),
  (1, 'viewer', 'createFollowUps', false),
  (1, 'viewer', 'editOutcomes', false),
  (1, 'viewer', 'viewAttempts', true),
  (1, 'viewer', 'browserDialer', false),
  (1, 'viewer', 'viewPhones', false),
  (1, 'viewer', 'markSent', false),
  (1, 'viewer', 'managerNotes', false),
  (1, 'viewer', 'viewOwnPipeline', true),
  (1, 'viewer', 'viewTeamPipeline', true),
  (1, 'viewer', 'viewAllPipelines', false),
  (1, 'viewer', 'moveStages', false),
  (1, 'viewer', 'manageCrm', false),
  (1, 'viewer', 'viewPrices', true),
  (1, 'viewer', 'viewCommissions', false),
  (1, 'viewer', 'editDealFinancials', false),
  (1, 'viewer', 'exportCrm', false),
  (1, 'viewer', 'manageCampaigns', false),
  (1, 'viewer', 'editCampaigns', false),
  (1, 'viewer', 'deleteCampaigns', false),
  (1, 'viewer', 'assignCampaigns', false),
  (1, 'viewer', 'createTemplates', false),
  (1, 'viewer', 'creativeMessages', false),
  (1, 'viewer', 'viewTeamMembers', true),
  (1, 'viewer', 'createTeams', false),
  (1, 'viewer', 'editTeams', false),
  (1, 'viewer', 'assignMembers', false),
  (1, 'viewer', 'assignManagers', false),
  (1, 'viewer', 'viewTeamReports', true),
  (1, 'viewer', 'viewCompetitions', true),
  (1, 'viewer', 'participate', false),
  (1, 'viewer', 'createCompetitions', false),
  (1, 'viewer', 'editCompetitions', false),
  (1, 'viewer', 'manageScoring', false),
  (1, 'viewer', 'viewAllResults', true),
  (1, 'viewer', 'createUsers', false),
  (1, 'viewer', 'editUsers', false),
  (1, 'viewer', 'deactivateUsers', false),
  (1, 'viewer', 'resetPasswords', false),
  (1, 'viewer', 'createRoles', false),
  (1, 'viewer', 'editPermissions', false),
  (1, 'viewer', 'manageIntegrations', false),
  (1, 'viewer', 'viewAudit', false),
  (1, 'viewer', 'exportReports', false),
  (1, 'viewer', 'manageSettings', false),
  (1, 'viewer', 'manageOutcomes', false),
  (1, 'viewer', 'manageFields', false),
  (1, 'viewer', 'manageStatuses', false);
-- Members
insert into members (id, org_id, first, last, email, role_id, active, created_at) values
  (1, 1, 'Travon', 'Burnette', 'travon@thebggroup.com', 'owner', true, '2026-09-01T09:00:00.000Z'),
  (2, 1, 'Maria', 'Lopez', 'maria@thebggroup.com', 'manager', true, '2026-09-01T09:00:00.000Z'),
  (3, 1, 'Devin', 'Carter', 'devin@thebggroup.com', 'agent', true, '2026-09-01T09:00:00.000Z');

-- Team (upgradeDb()'s default "Alpha Prospecting Team", seeded with every member)
insert into teams (id, org_id, name, description, color, manager_id, archived) values
  (1, 1, 'Alpha Prospecting Team', 'Everyone who prospects. The team you start with.', '#2F6FEB', 2, false);
insert into team_members (org_id, team_id, member_id) values
  (1, 1, 1),
  (1, 1, 2),
  (1, 1, 3);

-- Statuses (defaultStatuses())
insert into statuses (org_id, key, label, tone, active, locked, "order") values
  (1, 'new', 'New', 'blue', true, true, 0),
  (1, 'attempted', 'Attempted', '', true, true, 10),
  (1, 'contacted', 'Contacted', 'green', true, true, 20),
  (1, 'appointment', 'Appointment', 'green', true, true, 30),
  (1, 'do_not_call', 'Do Not Call', 'red', true, true, 40),
  (1, 'do_not_contact', 'Do Not Contact', 'red', true, true, 50),
  (1, 'closed', 'Closed', '', true, false, 60);

-- Outcomes
insert into outcomes (id, org_id, name, conv, appt, dnc, disabled) values
  (1, 1, 'No answer', false, false, false, false),
  (2, 1, 'Left voicemail', false, false, false, false),
  (3, 1, 'Wrong number', false, false, false, false),
  (4, 1, 'Not interested', true, false, false, false),
  (5, 1, 'Interested', true, false, false, false),
  (6, 1, 'Appointment set', true, true, false, false),
  (7, 1, 'Call back later', true, false, false, false),
  (8, 1, 'Do not call', false, false, true, false);

-- Built-in fields (defaultBuiltInFields())
insert into built_in_fields (org_id, key, label, visible, required, always) values
  (1, 'first', 'First name', true, false, true),
  (1, 'last', 'Last name', true, false, true),
  (1, 'phone', 'Phone', true, false, true),
  (1, 'email', 'Email', true, false, false),
  (1, 'addr', 'Street address', true, false, false),
  (1, 'city', 'City', true, false, false),
  (1, 'state', 'State', false, false, false),
  (1, 'zip', 'ZIP', true, false, false);

-- Custom fields
insert into custom_fields (id, org_id, key, label, type, choices, hint, in_table, on_card, active, "order") values
  (1, 1, 'listing_price', 'Listing price', 'money', '[]'::jsonb, 'What it was last listed at.', true, true, true, 10),
  (2, 1, 'expired_on', 'Expired on', 'date', '[]'::jsonb, '', false, true, true, 20),
  (3, 1, 'motivation', 'Motivation', 'choice', '["Hot", "Warm", "Cold"]'::jsonb, 'How ready they sound.', true, false, true, 30),
  (4, 1, 'vacant', 'Vacant', 'yes_no', '[]'::jsonb, '', false, false, true, 40);

-- Lists
insert into lists (id, org_id, name, archived, created_at) values
  (1, 1, 'Expired – Sept', false, '2026-09-09T14:20:00.000Z'),
  (2, 1, 'FSBO – Cobb', false, '2026-09-11T14:06:00.000Z'),
  (3, 1, 'Circle Prospecting', false, '2026-09-17T14:24:00.000Z');
-- Leads
insert into leads (id, org_id, first, last, email, addr, city, state, zip, assigned_id, status_key, dnc, dnt, dncontact, archived, source, created_at) values
  (1001, 1, 'Angela', 'Ruiz', 'aruiz@example.com', '1120 Peachtree Ln', 'Atlanta', '', '30309', 1, 'new', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1002, 1, 'Marcus', 'Bell', '', '88 Ridge Ave', 'Decatur', '', '30030', 2, 'contacted', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1003, 1, 'Denise', 'Okafor', '', '4410 Oak Hollow Dr', 'Marietta', '', '30062', 3, 'appointment', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1004, 1, 'Robert', 'Nguyen', '', '27 Mill Creek Ct', 'Roswell', '', '30075', 1, 'do_not_call', true, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1005, 1, 'Sharon', 'Whitfield', '', '301 Lenox Pointe', 'Atlanta', '', '30324', 2, 'contacted', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1006, 1, 'Kevin', 'Patel', '', '960 Glenwood Ave', 'Atlanta', '', '30316', 3, 'new', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1007, 1, 'Latoya', 'Green', '', '15 Powers Ferry Rd', 'Sandy Springs', '', '30328', 1, 'attempted', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1008, 1, 'Thomas', 'Reed', '', '720 Johnson Ferry', 'Marietta', '', '30068', 2, 'do_not_contact', true, true, true, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1009, 1, 'Priya', 'Shah', '', '2200 Howell Mill Rd', 'Atlanta', '', '30318', 1, 'attempted', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1010, 1, 'William', 'Foster', '', '55 Church St', 'Decatur', '', '30030', 3, 'new', false, true, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1011, 1, 'Monica', 'Alvarez', '', '8 Ansley Walk', 'Atlanta', '', '30309', 2, 'contacted', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1012, 1, 'Jerome', 'Hicks', '', '1409 Canton Rd', 'Marietta', '', '30066', 1, 'attempted', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1013, 1, 'Brianna', 'Cole', '', '77 Highland Ave', 'Atlanta', '', '30312', 3, 'new', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z'),
  (1014, 1, 'Samuel', 'Ortiz', '', '640 Roswell Rd', 'Marietta', '', '30062', 1, 'new', false, false, false, false, 'import', '2026-09-14T14:45:00.000Z');

-- Lead phones (lead.phones[], position = array index)
insert into lead_phones (org_id, lead_id, n, type, "position") values
  (1, 1001, '+14045550142', 'mobile', 0),
  (1, 1001, '+14045550190', 'home', 1),
  (1, 1002, '+14045550177', 'mobile', 0),
  (1, 1003, '+16785550123', 'mobile', 0),
  (1, 1004, '+17705550164', 'mobile', 0),
  (1, 1005, '+14045550118', 'home', 0),
  (1, 1006, '+14045550155', 'mobile', 0),
  (1, 1007, '+16785550199', 'mobile', 0),
  (1, 1008, '+17705550131', 'mobile', 0),
  (1, 1009, '+14045550101', 'mobile', 0),
  (1, 1010, '+16785550144', 'work', 0),
  (1, 1011, '+14045550166', 'mobile', 0),
  (1, 1012, '+17705550188', 'mobile', 0),
  (1, 1013, '+14045550133', 'mobile', 0),
  (1, 1014, '+17705550122', 'mobile', 0);

-- Lead list memberships (lead.listIds[])
insert into lead_lists (org_id, lead_id, list_id) values
  (1, 1001, 1),
  (1, 1002, 1),
  (1, 1003, 2),
  (1, 1004, 2),
  (1, 1005, 3),
  (1, 1006, 3),
  (1, 1007, 1),
  (1, 1008, 2),
  (1, 1009, 3),
  (1, 1010, 1),
  (1, 1011, 3),
  (1, 1012, 2),
  (1, 1013, 1),
  (1, 1014, 2);

-- Lead custom field values (lead.custom{}, sparse — only set keys get a row)
insert into lead_custom_values (org_id, lead_id, field_key, value) values
  (1, 1001, 'listing_price', '425000'::jsonb),
  (1, 1001, 'expired_on', '"2026-08-30"'::jsonb),
  (1, 1001, 'motivation', '"Hot"'::jsonb),
  (1, 1002, 'listing_price', '319000'::jsonb),
  (1, 1002, 'motivation', '"Warm"'::jsonb),
  (1, 1003, 'listing_price', '540000'::jsonb),
  (1, 1003, 'motivation', '"Hot"'::jsonb),
  (1, 1003, 'vacant', 'true'::jsonb),
  (1, 1007, 'expired_on', '"2026-09-02"'::jsonb);
-- Templates
insert into templates (id, org_id, name, style, body) values
  (1, 1, 'Expired – first touch', 'friendly', 'Hi {{first_name}}, this is {{agent_name}} with The BG Group. I noticed your home on {{address}} came off the market — would you be open to a quick chat about what a fresh strategy could look like?'),
  (2, 1, 'FSBO – offer help', 'standard', 'Hi {{first_name}}, {{agent_name}} here with The BG Group. Congrats on listing {{address}} yourself! If it''d help, I can share what buyers in {{city}} are looking for right now — no pressure.'),
  (3, 1, 'Just listed – neighbours', 'short', 'Hi {{first_name}}, it''s {{agent_name}} with The BG Group. We just listed a home near {{address}}. Know anyone in {{city}} thinking about a move?'),
  (4, 1, 'Follow-up nudge', 'short', 'Hi {{first_name}}, {{agent_name}} again — just checking in on {{address}}. Any questions I can answer?');

-- Campaigns
insert into campaigns (id, org_id, name, type, body, archived, created_at) values
  (1, 1, 'Expired Listings – Sept', 'expired_listing', 'Hi {{first_name}}, this is {{agent_name}} with The BG Group. I noticed your home on {{address}} came off the market — would you be open to a quick chat about what a fresh strategy could look like?', false, '2026-09-15T14:38:00.000Z'),
  (2, 1, 'FSBO Outreach', 'custom', 'Hi {{first_name}}, {{agent_name}} here with The BG Group. Congrats on listing {{address}} yourself! If it''d help, I can share what buyers in {{city}} are looking for right now — no pressure.', false, '2026-09-19T14:10:00.000Z'),
  (3, 1, 'Just Listed – Ansley', 'just_listed', 'Hi {{first_name}}, it''s {{agent_name}} with The BG Group. We just listed a home near {{address}}. Know anyone in {{city}} thinking about a move?', false, '2026-09-24T14:35:00.000Z');

-- Campaign leads (per-lead send status on a campaign)
insert into campaign_leads (id, org_id, campaign_id, lead_id, body, status, sent_at, sent_by, replied_at) values
  (1051, 1, 1, 1001, NULL, 'draft', NULL, NULL, NULL),
  (1052, 1, 1, 1002, NULL, 'sent', '2026-09-26T14:21:00.000Z', 2, NULL),
  (1053, 1, 1, 1007, NULL, 'ready', NULL, NULL, NULL),
  (1054, 1, 1, 1010, NULL, 'draft', NULL, NULL, NULL),
  (1055, 1, 1, 1013, NULL, 'draft', NULL, NULL, NULL),
  (1056, 1, 2, 1003, NULL, 'replied', '2026-09-24T14:35:00.000Z', 3, '2026-09-25T14:28:00.000Z'),
  (1057, 1, 2, 1012, NULL, 'draft', NULL, NULL, NULL),
  (1058, 1, 2, 1014, NULL, 'draft', NULL, NULL, NULL),
  (1059, 1, 3, 1005, NULL, 'sent', '2026-09-20T14:03:00.000Z', 2, NULL),
  (1060, 1, 3, 1006, NULL, 'draft', NULL, NULL, NULL),
  (1061, 1, 3, 1011, NULL, 'draft', NULL, NULL, NULL);

-- Activities (call/text/door-knock log) — after campaigns, since some
-- activities reference campaign_id.
insert into activities (id, org_id, lead_id, type, outcome_id, user_id, at, note, list_id, campaign_id, duration_min) values
  (1015, 1, 1002, 'call', 7, 2, '2026-09-28T14:07:00.000Z', 'Asked to call back after 5pm.', 1, NULL, 1),
  (1016, 1, 1002, 'text', 1, 2, '2026-09-26T14:21:00.000Z', '', 1, 1, NULL),
  (1017, 1, 1002, 'call', 1, 2, '2026-09-24T14:35:00.000Z', '', 1, NULL, 0),
  (1018, 1, 1003, 'call', 6, 3, '2026-09-27T14:14:00.000Z', 'Listing appointment Thursday 4pm.', 2, NULL, 2),
  (1019, 1, 1003, 'call', 5, 3, '2026-09-25T14:28:00.000Z', '', 2, NULL, 4),
  (1020, 1, 1005, 'call', 5, 2, '2026-09-26T14:21:00.000Z', 'Thinking about selling in spring.', 3, NULL, 3),
  (1021, 1, 1005, 'call', 1, 2, '2026-09-23T14:42:00.000Z', '', 3, NULL, 1),
  (1022, 1, 1005, 'call', 1, 2, '2026-09-21T14:56:00.000Z', '', 3, NULL, 3),
  (1023, 1, 1005, 'text', 1, 2, '2026-09-20T14:03:00.000Z', '', 3, 3, NULL),
  (1024, 1, 1009, 'call', 1, 1, '2026-09-29T13:00:00.000Z', '', 3, NULL, 0),
  (1025, 1, 1007, 'call', 2, 1, '2026-09-25T14:28:00.000Z', '', 1, NULL, 4),
  (1026, 1, 1007, 'call', 1, 1, '2026-09-22T14:49:00.000Z', '', 1, NULL, 2),
  (1027, 1, 1012, 'door_knock', 1, 1, '2026-09-27T14:14:00.000Z', 'Left flyer.', 2, NULL, NULL),
  (1028, 1, 1012, 'call', 1, 1, '2026-09-26T14:21:00.000Z', '', 2, NULL, 3),
  (1029, 1, 1012, 'call', 1, 1, '2026-09-24T14:35:00.000Z', '', 2, NULL, 0),
  (1030, 1, 1012, 'call', 1, 1, '2026-09-20T14:03:00.000Z', '', 2, NULL, 4),
  (1031, 1, 1012, 'call', 2, 1, '2026-09-17T14:24:00.000Z', '', 2, NULL, 2),
  (1032, 1, 1004, 'call', 8, 1, '2026-09-23T14:42:00.000Z', 'Asked not to be called again.', 2, NULL, 1),
  (1033, 1, 1008, 'call', 4, 2, '2026-09-20T14:03:00.000Z', '', 2, NULL, 4),
  (1034, 1, 1001, 'call', 1, 1, '2026-09-28T14:07:00.000Z', '', 1, NULL, 1),
  (1035, 1, 1001, 'call', 2, 1, '2026-09-27T15:14:00.000Z', '', 1, NULL, 2),
  (1036, 1, 1013, 'call', 1, 3, '2026-09-28T14:07:00.000Z', '', 1, NULL, 1),
  (1037, 1, 1006, 'call', 5, 3, '2026-09-27T14:14:00.000Z', 'Might sell next year.', 3, NULL, 2),
  (1038, 1, 1010, 'call', 1, 3, '2026-09-26T14:21:00.000Z', '', 1, NULL, 3),
  (1039, 1, 1014, 'call', 1, 1, '2026-09-16T14:31:00.000Z', '', 2, NULL, 3),
  (1040, 1, 1011, 'call', 7, 2, '2026-09-27T14:14:00.000Z', 'Call Monday.', 3, NULL, 2),
  (1041, 1, 1011, 'call', 1, 2, '2026-09-19T14:10:00.000Z', '', 3, NULL, 0);

-- Follow-ups
insert into follow_ups (id, org_id, lead_id, due, status, note, assignee_id, created_at) values
  (1042, 1, 1002, '2026-09-29', 'pending', 'Call after 5pm', 2, '2026-09-28T14:07:00.000Z'),
  (1043, 1, 1003, '2026-10-02', 'pending', 'Listing appointment', 3, '2026-09-27T14:14:00.000Z'),
  (1044, 1, 1005, '2026-09-28', 'pending', 'Follow up on spring plans', 2, '2026-09-26T14:21:00.000Z'),
  (1045, 1, 1007, '2026-09-30', 'pending', '', 1, '2026-09-25T14:28:00.000Z'),
  (1046, 1, 1009, '2026-10-01', 'pending', '', 1, '2026-09-29T14:00:00.000Z'),
  (1047, 1, 1011, '2026-09-29', 'pending', 'Call Monday', 2, '2026-09-27T14:14:00.000Z');

-- Notes
insert into notes (id, org_id, lead_id, user_id, at, text, kind) values
  (1048, 1, 1003, 3, '2026-09-27T14:14:00.000Z', 'Wants a CMA before the appointment.', 'quick'),
  (1049, 1, 1005, 2, '2026-09-26T14:21:00.000Z', 'Husband is the decision maker.', 'quick'),
  (1050, 1, 1005, 1, '2026-09-27T14:14:00.000Z', 'High-value lead — coach Maria on the follow-up.', 'manager');
-- Imports (leadIds:[] in the demo seed — Undo is hidden for these, a known,
-- deliberately-preserved quirk of the seed data, not a bug in this schema)
insert into imports (id, org_id, file, list_id, rows, imported, dups, status, by_id, at) values
  (1062, 1, 'expired-sept.xlsx', 1, 412, 398, 14, 'completed', 1, '2026-09-09T14:20:00.000Z'),
  (1063, 1, 'fsbo-cobb.csv', 2, 220, 220, 0, 'completed', 1, '2026-09-11T14:06:00.000Z');
-- (no import_leads rows: both seed imports have an empty leadIds[])

-- Pipelines (newPipeline() x2, each with defaultStages()'s 14 stages)
insert into pipelines (id, org_id, name, kind, archived, created_at) values
  (1071, 1, 'Seller Leads', 'seller', false, '2026-09-29T20:27:51.074Z'),
  (1086, 1, 'Probate', 'probate', false, '2026-09-29T20:27:51.074Z');

insert into stages (id, org_id, pipeline_id, name, prob, kind, color, archived, "position") values
  (1072, 1, 1071, 'New Lead', 5, 'active', '#8E8E93', false, 0),
  (1073, 1, 1071, 'Attempting Contact', 10, 'active', '#8E8E93', false, 1),
  (1074, 1, 1071, 'Contact Made', 15, 'active', '#0A84FF', false, 2),
  (1075, 1, 1071, 'Follow-Up', 20, 'active', '#0A84FF', false, 3),
  (1076, 1, 1071, 'Appointment Scheduled', 35, 'active', '#5E5CE6', false, 4),
  (1077, 1, 1071, 'Appointment Completed', 45, 'active', '#5E5CE6', false, 5),
  (1078, 1, 1071, 'Potential Client', 55, 'active', '#BF5AF2', false, 6),
  (1079, 1, 1071, 'Listing Agreement Sent', 65, 'active', '#FF9F0A', false, 7),
  (1080, 1, 1071, 'Listing Signed', 80, 'active', '#FF9F0A', false, 8),
  (1081, 1, 1071, 'Active Listing', 85, 'active', '#30D158', false, 9),
  (1082, 1, 1071, 'Under Contract', 95, 'active', '#30D158', false, 10),
  (1083, 1, 1071, 'Closed', 100, 'closed', '#30D158', false, 11),
  (1084, 1, 1071, 'Long-Term Nurture', 5, 'active', '#64D2FF', false, 12),
  (1085, 1, 1071, 'Lost Lead', 0, 'lost', '#FF453A', false, 13),
  (1087, 1, 1086, 'New Lead', 5, 'active', '#8E8E93', false, 0),
  (1088, 1, 1086, 'Attempting Contact', 10, 'active', '#8E8E93', false, 1),
  (1089, 1, 1086, 'Contact Made', 15, 'active', '#0A84FF', false, 2),
  (1090, 1, 1086, 'Follow-Up', 20, 'active', '#0A84FF', false, 3),
  (1091, 1, 1086, 'Appointment Scheduled', 35, 'active', '#5E5CE6', false, 4),
  (1092, 1, 1086, 'Appointment Completed', 45, 'active', '#5E5CE6', false, 5),
  (1093, 1, 1086, 'Potential Client', 55, 'active', '#BF5AF2', false, 6),
  (1094, 1, 1086, 'Listing Agreement Sent', 65, 'active', '#FF9F0A', false, 7),
  (1095, 1, 1086, 'Listing Signed', 80, 'active', '#FF9F0A', false, 8),
  (1096, 1, 1086, 'Active Listing', 85, 'active', '#30D158', false, 9),
  (1097, 1, 1086, 'Under Contract', 95, 'active', '#30D158', false, 10),
  (1098, 1, 1086, 'Closed', 100, 'closed', '#30D158', false, 11),
  (1099, 1, 1086, 'Long-Term Nurture', 5, 'active', '#64D2FF', false, 12),
  (1100, 1, 1086, 'Lost Lead', 0, 'lost', '#FF453A', false, 13);

-- Deals (5 leads already qualified into the Seller Leads pipeline)
insert into deals (id, org_id, lead_id, pipeline_id, stage_id, assigned_id, temperature, price, comm_pct, referral_pct, team_split_pct, brokerage_pct, brokerage_fee, closing_costs, close_date, next_fu, notes, stage_entered_at, created_by, created_at) values
  (1101, 1, 1001, 1071, 1076, 1, 'hot', 425000, 3, 0, 0, 0, 0, 0, '2026-11-15', '2026-10-01', 'Expired in August, wants a fresh strategy.', '2026-09-27T14:14:00.000Z', 1, '2026-09-25T14:28:00.000Z'),
  (1104, 1, 1002, 1071, 1075, 2, 'warm', 319000, 3, 0, 0, 0, 0, 0, NULL, '2026-09-26', '', '2026-09-20T14:03:00.000Z', 1, '2026-09-18T14:17:00.000Z'),
  (1107, 1, 1003, 1071, 1080, 3, 'hot', 540000, 3, 0, 0, 20, 0, 0, '2026-10-30', '2026-09-30', '', '2026-09-24T14:35:00.000Z', 1, '2026-09-22T14:49:00.000Z'),
  (1110, 1, 1005, 1071, 1074, 2, 'cold', 280000, 3, 0, 0, 0, 0, 0, NULL, NULL, '', '2026-09-15T14:38:00.000Z', 1, '2026-09-13T14:52:00.000Z'),
  (1113, 1, 1006, 1071, 1072, 3, 'warm', 350000, 3, 0, 0, 0, 0, 0, NULL, NULL, '', '2026-09-28T14:07:00.000Z', 1, '2026-09-26T14:21:00.000Z');

-- Deal history (dealLog(): 2 entries per seed deal — created, then the stage move)
insert into deal_history (id, org_id, deal_id, at, user_id, type, detail) values
  (1102, 1, 1101, '2026-09-25T14:28:00.000Z', 1, 'created', 'Added to Seller Leads by Travon Burnette'),
  (1103, 1, 1101, '2026-09-27T14:14:00.000Z', 1, 'stage', 'New Lead → Appointment Scheduled'),
  (1105, 1, 1104, '2026-09-18T14:17:00.000Z', 1, 'created', 'Added to Seller Leads by Travon Burnette'),
  (1106, 1, 1104, '2026-09-20T14:03:00.000Z', 1, 'stage', 'New Lead → Follow-Up'),
  (1108, 1, 1107, '2026-09-22T14:49:00.000Z', 1, 'created', 'Added to Seller Leads by Travon Burnette'),
  (1109, 1, 1107, '2026-09-24T14:35:00.000Z', 1, 'stage', 'New Lead → Listing Signed'),
  (1111, 1, 1110, '2026-09-13T14:52:00.000Z', 1, 'created', 'Added to Seller Leads by Travon Burnette'),
  (1112, 1, 1110, '2026-09-15T14:38:00.000Z', 1, 'stage', 'New Lead → Contact Made'),
  (1114, 1, 1113, '2026-09-26T14:21:00.000Z', 1, 'created', 'Added to Seller Leads by Travon Burnette'),
  (1115, 1, 1113, '2026-09-28T14:07:00.000Z', 1, 'stage', 'New Lead → New Lead');

-- Org settings
insert into org_settings (org_id, team_name, agent_name, table_columns, card_fields, pts_call, pts_text, pts_door, pts_conv, pts_appt, weekly_goal, working_days, import_cfg) values
  (1, 'The BG Group', 'Travon', '[]'::jsonb, '[]'::jsonb, 1, 1, 2, 5, 25, 250, '[1, 2, 3, 4, 5]'::jsonb, '{"phoneSlots": 10, "emailSlots": 1, "dupPhone": true, "dupEmail": true, "dupAddress": true, "maxRows": 50000, "requireName": false, "requirePhone": false, "flagDnc": true, "defaultAssign": "", "defaultList": ""}'::jsonb);

-- Audit log (seed-time entries from data/seed.js)
insert into audit_log (id, org_id, at, user_id, action, table_name, detail) values
  (1068, 1, '2026-09-09T14:20:00.000Z', 1, 'created', 'lists', 'Expired – Sept'),
  (1069, 1, '2026-09-15T14:38:00.000Z', 1, 'created', 'campaigns', 'Expired Listings – Sept'),
  (1070, 1, '2026-09-23T14:42:00.000Z', 1, 'updated', 'leads', 'Robert Nguyen → Do Not Call');

-- Bump identity sequences past the explicit ids inserted above, so the next
-- app-generated row in each table doesn't collide with a seeded id.
select setval(pg_get_serial_sequence('orgs', 'id'), coalesce((select max(id) from orgs), 1));
select setval(pg_get_serial_sequence('members', 'id'), coalesce((select max(id) from members), 1));
select setval(pg_get_serial_sequence('teams', 'id'), coalesce((select max(id) from teams), 1));
select setval(pg_get_serial_sequence('outcomes', 'id'), coalesce((select max(id) from outcomes), 1));
select setval(pg_get_serial_sequence('custom_fields', 'id'), coalesce((select max(id) from custom_fields), 1));
select setval(pg_get_serial_sequence('lists', 'id'), coalesce((select max(id) from lists), 1));
select setval(pg_get_serial_sequence('leads', 'id'), coalesce((select max(id) from leads), 1));
select setval(pg_get_serial_sequence('activities', 'id'), coalesce((select max(id) from activities), 1));
select setval(pg_get_serial_sequence('follow_ups', 'id'), coalesce((select max(id) from follow_ups), 1));
select setval(pg_get_serial_sequence('notes', 'id'), coalesce((select max(id) from notes), 1));
select setval(pg_get_serial_sequence('templates', 'id'), coalesce((select max(id) from templates), 1));
select setval(pg_get_serial_sequence('campaigns', 'id'), coalesce((select max(id) from campaigns), 1));
select setval(pg_get_serial_sequence('campaign_leads', 'id'), coalesce((select max(id) from campaign_leads), 1));
select setval(pg_get_serial_sequence('imports', 'id'), coalesce((select max(id) from imports), 1));
select setval(pg_get_serial_sequence('pipelines', 'id'), coalesce((select max(id) from pipelines), 1));
select setval(pg_get_serial_sequence('stages', 'id'), coalesce((select max(id) from stages), 1));
select setval(pg_get_serial_sequence('deals', 'id'), coalesce((select max(id) from deals), 1));
select setval(pg_get_serial_sequence('deal_history', 'id'), coalesce((select max(id) from deal_history), 1));
select setval(pg_get_serial_sequence('audit_log', 'id'), coalesce((select max(id) from audit_log), 1));

commit;