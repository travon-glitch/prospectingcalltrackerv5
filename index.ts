// supabase/functions/save-permissions
//
// Server-side half of views/admin.js's Roles & permissions tab
// (ADM.roles / savePermissions / roleDlg / deleteRole). roles and
// role_permissions have no RLS of their own (Stage 4's migration only
// covers leads/deals/follow_ups/activities/notes — the tables can() itself
// gates), so every write to a role has to go through this function instead,
// which re-checks the same can() calls the client already made before
// showing the button, plus the guards the demo enforces on save:
//   - a role can't remove its own "Edit permissions" (savePermissions())
//   - a member's role can't be changed away from Super Administrator if
//     they're the org's last active one (saveUser())
//   - the Super Administrator role itself (roles.super_admin) is immutable:
//     always every permission, never renamed, never deleted — exactly what
//     the client already hides (sel.superAdmin disables Rename/Delete/the
//     permission checkboxes; ADM.roles's own alert text says so)
//
// Deploy: supabase functions deploy save-permissions
// Call with: Authorization: Bearer <the calling member's access token>
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

type Body = {
  action?: "save_permissions" | "create_role" | "rename_role" | "delete_role" | "set_member_role";
  org_id?: number;
  role_id?: string;
  name?: string;
  description?: string;
  base_role_id?: string | null; // create_role: role to copy perms from, or null for all-off (roleDlg's "Nothing (all off)")
  perms?: Record<string, boolean>; // save_permissions: the full next perms map, same shape savePermissions() builds client-side
  member_id?: number; // set_member_role
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json({ error: "Missing Authorization header" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const { action, org_id } = body;
  if (!action || !org_id) return json({ error: "action and org_id are required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Who is calling? Same "resolve auth user -> members row -> role" shape
  // admin-create-user uses, so both functions treat a deactivated caller or
  // a cross-org call the same way.
  const { data: callerAuth, error: callerAuthErr } = await admin.auth.getUser(callerToken);
  if (callerAuthErr || !callerAuth?.user) return json({ error: "Not signed in" }, 401);

  const { data: caller, error: callerErr } = await admin
    .from("members")
    .select("id, org_id, role_id, active")
    .eq("auth_user_id", callerAuth.user.id)
    .maybeSingle();
  if (callerErr) return json({ error: callerErr.message }, 500);
  if (!caller || !caller.active) return json({ error: "This account has been deactivated. Ask an administrator." }, 403);
  if (caller.org_id !== org_id) return json({ error: "You can't change roles in another org" }, 403);

  const { data: callerRole, error: callerRoleErr } = await admin
    .from("roles")
    .select("super_admin")
    .eq("org_id", caller.org_id)
    .eq("id", caller.role_id)
    .maybeSingle();
  if (callerRoleErr) return json({ error: callerRoleErr.message }, 500);
  const callerIsSuperAdmin = !!callerRole?.super_admin;

  async function callerHas(permKey: string): Promise<boolean> {
    if (callerIsSuperAdmin) return true;
    const { data, error } = await admin
      .from("role_permissions")
      .select("allowed")
      .eq("org_id", caller.org_id)
      .eq("role_id", caller.role_id)
      .eq("permission_key", permKey)
      .maybeSingle();
    if (error) throw error;
    return !!data?.allowed;
  }

  try {
    switch (action) {
      // ---------------------------------------------------- save_permissions
      case "save_permissions": {
        const { role_id, perms } = body;
        if (!role_id || !perms) return json({ error: "role_id and perms are required" }, 400);
        if (!(await callerHas("editPermissions"))) {
          return json({ error: "You don't have permission to do that" }, 403);
        }
        const { data: role, error: roleErr } = await admin
          .from("roles")
          .select("id, super_admin")
          .eq("org_id", org_id)
          .eq("id", role_id)
          .maybeSingle();
        if (roleErr) return json({ error: roleErr.message }, 500);
        if (!role) return json({ error: `Unknown role "${role_id}"` }, 400);
        // "The Super Administrator always has every permission. It cannot be
        // reduced" — same wording ADM.roles shows next to a locked role.
        if (role.super_admin) {
          return json({ error: "The Super Administrator always has every permission and can't be changed" }, 403);
        }
        // savePermissions(): `if(r.id===me.role && !next.editPermissions)`
        if (role_id === caller.role_id && perms.editPermissions === false) {
          return json({ error: "You can't remove your own “Edit permissions” — ask another administrator" }, 403);
        }

        const rows = Object.entries(perms).map(([permission_key, allowed]) => ({
          org_id, role_id, permission_key, allowed: !!allowed,
        }));
        const { error: upsertErr } = await admin
          .from("role_permissions")
          .upsert(rows, { onConflict: "org_id,role_id,permission_key" });
        if (upsertErr) return json({ error: upsertErr.message }, 500);

        const n = rows.filter((r) => r.allowed).length;
        await admin.from("audit_log").insert({
          org_id, user_id: caller.id, action: "updated", table_name: "roles",
          detail: `${role_id} · ${n} permissions`,
        });
        return json({ ok: true });
      }

      // -------------------------------------------------------- create_role
      case "create_role": {
        const { role_id, name, description, base_role_id } = body;
        if (!role_id || !name?.trim()) return json({ error: "Give the role a name" }, 400);
        if (!(await callerHas("createRoles"))) {
          return json({ error: "You don't have permission to do that" }, 403);
        }
        const { data: clash, error: clashErr } = await admin
          .from("roles").select("id").eq("org_id", org_id).ilike("name", name.trim()).maybeSingle();
        if (clashErr) return json({ error: clashErr.message }, 500);
        if (clash) return json({ error: "A role with that name already exists" }, 409);

        const { error: insErr } = await admin.from("roles").insert({
          org_id, id: role_id, name: name.trim(), description: description?.trim() ?? "",
          built_in: false, super_admin: false,
        });
        if (insErr) return json({ error: insErr.message }, 500);

        let basePerms: Record<string, boolean> = {};
        if (base_role_id) {
          const { data: baseRows, error: baseErr } = await admin
            .from("role_permissions").select("permission_key, allowed")
            .eq("org_id", org_id).eq("role_id", base_role_id);
          if (baseErr) return json({ error: baseErr.message }, 500);
          for (const r of baseRows ?? []) basePerms[r.permission_key] = r.allowed;
        }
        if (Object.keys(basePerms).length) {
          const rows = Object.entries(basePerms).map(([permission_key, allowed]) => ({
            org_id, role_id, permission_key, allowed,
          }));
          const { error: permErr } = await admin.from("role_permissions").upsert(rows, { onConflict: "org_id,role_id,permission_key" });
          if (permErr) return json({ error: permErr.message }, 500);
        }

        await admin.from("audit_log").insert({ org_id, user_id: caller.id, action: "created", table_name: "roles", detail: name.trim() });
        return json({ ok: true, role_id });
      }

      // -------------------------------------------------------- rename_role
      case "rename_role": {
        const { role_id, name, description } = body;
        if (!role_id || !name?.trim()) return json({ error: "Give the role a name" }, 400);
        if (!(await callerHas("editPermissions"))) {
          return json({ error: "You don't have permission to do that" }, 403);
        }
        const { data: role, error: roleErr } = await admin
          .from("roles").select("id, super_admin").eq("org_id", org_id).eq("id", role_id).maybeSingle();
        if (roleErr) return json({ error: roleErr.message }, 500);
        if (!role) return json({ error: `Unknown role "${role_id}"` }, 400);
        if (role.super_admin) {
          return json({ error: "The Super Administrator role can't be renamed" }, 403);
        }
        const { data: clash, error: clashErr } = await admin
          .from("roles").select("id").eq("org_id", org_id).ilike("name", name.trim()).neq("id", role_id).maybeSingle();
        if (clashErr) return json({ error: clashErr.message }, 500);
        if (clash) return json({ error: "A role with that name already exists" }, 409);

        const { error: updErr } = await admin.from("roles")
          .update({ name: name.trim(), description: description?.trim() ?? "" })
          .eq("org_id", org_id).eq("id", role_id);
        if (updErr) return json({ error: updErr.message }, 500);

        await admin.from("audit_log").insert({ org_id, user_id: caller.id, action: "updated", table_name: "roles", detail: name.trim() });
        return json({ ok: true });
      }

      // -------------------------------------------------------- delete_role
      case "delete_role": {
        const { role_id } = body;
        if (!role_id) return json({ error: "role_id is required" }, 400);
        if (!(await callerHas("editPermissions"))) {
          return json({ error: "You don't have permission to do that" }, 403);
        }
        const { data: role, error: roleErr } = await admin
          .from("roles").select("id, built_in, super_admin, name").eq("org_id", org_id).eq("id", role_id).maybeSingle();
        if (roleErr) return json({ error: roleErr.message }, 500);
        if (!role) return json({ error: `Unknown role "${role_id}"` }, 400);
        if (role.built_in || role.super_admin) {
          return json({ error: "Built-in roles can't be deleted" }, 403);
        }
        const { count, error: countErr } = await admin
          .from("members").select("id", { count: "exact", head: true }).eq("org_id", org_id).eq("role_id", role_id);
        if (countErr) return json({ error: countErr.message }, 500);
        const n = count ?? 0;
        // deleteRole(): `${n} user${n===1?" has":"s have"} this role — move them to another role first`
        if (n) return json({ error: `${n} user${n === 1 ? " has" : "s have"} this role — move them to another role first` }, 409);

        const { error: delErr } = await admin.from("roles").delete().eq("org_id", org_id).eq("id", role_id);
        if (delErr) return json({ error: delErr.message }, 500);

        await admin.from("audit_log").insert({ org_id, user_id: caller.id, action: "deleted", table_name: "roles", detail: role.name });
        return json({ ok: true });
      }

      // ---------------------------------------------------- set_member_role
      // saveUser()'s role-change guard, exposed here now (per the demo's own
      // "last active Super Administrator can't be ... demoted" copy in
      // ADM.roles) so the admin UI Stage 12 wires up doesn't have to
      // re-derive this rule.
      case "set_member_role": {
        const { member_id, role_id } = body;
        if (!member_id || !role_id) return json({ error: "member_id and role_id are required" }, 400);
        if (!(await callerHas("editUsers"))) {
          return json({ error: "You don't have permission to do that" }, 403);
        }
        const { data: target, error: targetErr } = await admin
          .from("members").select("id, org_id, role_id, active").eq("id", member_id).maybeSingle();
        if (targetErr) return json({ error: targetErr.message }, 500);
        if (!target || target.org_id !== org_id) return json({ error: "Unknown user" }, 404);

        const { data: targetRole, error: targetRoleErr } = await admin
          .from("roles").select("super_admin").eq("org_id", org_id).eq("id", target.role_id).maybeSingle();
        if (targetRoleErr) return json({ error: targetRoleErr.message }, 500);

        if (targetRole?.super_admin && role_id !== target.role_id) {
          const { count, error: countErr } = await admin
            .from("members")
            .select("id, roles!inner(super_admin)", { count: "exact", head: true })
            .eq("org_id", org_id).eq("active", true).eq("roles.super_admin", true);
          if (countErr) return json({ error: countErr.message }, 500);
          if ((count ?? 0) <= 1) {
            return json({ error: "You can't change the role of the last Super Administrator" }, 403);
          }
        }

        const { data: newRole, error: newRoleErr } = await admin
          .from("roles").select("id").eq("org_id", org_id).eq("id", role_id).maybeSingle();
        if (newRoleErr) return json({ error: newRoleErr.message }, 500);
        if (!newRole) return json({ error: `Unknown role "${role_id}"` }, 400);

        const { error: updErr } = await admin.from("members").update({ role_id }).eq("id", member_id);
        if (updErr) return json({ error: updErr.message }, 500);

        await admin.from("audit_log").insert({ org_id, user_id: caller.id, action: "updated", table_name: "users", detail: `member ${member_id} → ${role_id}` });
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action "${action}"` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
