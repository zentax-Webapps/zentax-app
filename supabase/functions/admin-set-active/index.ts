// POST /functions/v1/admin-set-active
// Body: { user_id, active: boolean }
// Caller must be a super_admin.
// Deactivating bans the auth user so they can't log in AND flips is_active in profiles.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireSuperAdmin } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405);

  const guard = await requireSuperAdmin(req);
  if ("error" in guard) return jsonResponse({ error: guard.error }, guard.status);
  const { admin } = guard;

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  const { user_id, active } = body ?? {};
  if (!user_id || typeof active !== "boolean")
    return jsonResponse({ error: "user_id and active(boolean) required" }, 400);

  // Ban or unban via ban_duration ("none" unbans; "876000h" ≈ 100 years bans)
  const { error: bErr } = await admin.auth.admin.updateUserById(String(user_id), {
    ban_duration: active ? "none" : "876000h",
  });
  if (bErr) return jsonResponse({ error: bErr.message }, 400);

  const { error: uErr } = await admin
    .from("profiles")
    .update({ is_active: active })
    .eq("id", user_id);
  if (uErr) return jsonResponse({ error: uErr.message }, 400);

  return jsonResponse({ ok: true });
});
