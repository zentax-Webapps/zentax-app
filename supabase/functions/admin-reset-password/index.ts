// POST /functions/v1/admin-reset-password
// Body: { user_id, new_password }
// Caller must be a super_admin.
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
  const { user_id, new_password } = body ?? {};
  if (!user_id || !new_password)
    return jsonResponse({ error: "user_id and new_password required" }, 400);
  if (String(new_password).length < 8)
    return jsonResponse({ error: "Password must be at least 8 characters" }, 400);

  const { error } = await admin.auth.admin.updateUserById(String(user_id), {
    password: String(new_password),
  });
  if (error) return jsonResponse({ error: error.message }, 400);

  return jsonResponse({ ok: true });
});
