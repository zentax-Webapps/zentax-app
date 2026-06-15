// POST /functions/v1/admin-create-user
// Body: { email, password, full_name, role, phone? }
// Caller must be a super_admin.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/admin.ts";

const ROLES = ["super_admin","admin","team_member","client_owner","client_executive"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405);

  const guard = await requireSuperAdmin(req);
  if ("error" in guard) return jsonResponse({ error: guard.error }, guard.status);
  const { admin, caller } = guard;

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  const { email, password, full_name, role, phone } = body ?? {};
  if (!email || !password || !full_name || !role)
    return jsonResponse({ error: "email, password, full_name, role required" }, 400);
  if (!ROLES.includes(role)) return jsonResponse({ error: "Invalid role" }, 400);
  if (String(password).length < 8)
    return jsonResponse({ error: "Password must be at least 8 characters" }, 400);

  // Create the auth user (email_confirm skips the verification email)
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: String(email).trim().toLowerCase(),
    password: String(password),
    email_confirm: true,
    user_metadata: { full_name, role },
  });
  if (cErr || !created.user) {
    return jsonResponse({ error: cErr?.message ?? "Could not create auth user" }, 400);
  }

  // Insert the profile row
  const { error: insErr } = await admin.from("profiles").insert({
    id: created.user.id,
    email: created.user.email,
    full_name: String(full_name).trim(),
    role,
    phone: phone || null,
    is_active: true,
    created_by: caller.id,
  });
  if (insErr) {
    // Roll back the auth user so we don't end up with orphans
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonResponse({ error: "Profile insert failed: " + insErr.message }, 500);
  }

  return jsonResponse({ id: created.user.id, email: created.user.email });
});
