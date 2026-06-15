// Shared helper: build the privileged client AND verify the caller is super_admin.
// Edge Functions use the service-role key — never expose this key to the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function requireSuperAdmin(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { error: "Missing token", status: 401 as const };

  const admin = adminClient();
  const { data: userRes, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !userRes.user) {
    return { error: "Invalid token", status: 401 as const };
  }
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (pErr || !profile) return { error: "Profile not found", status: 403 as const };
  if (!profile.is_active) return { error: "Inactive user", status: 403 as const };
  if (profile.role !== "super_admin") {
    return { error: "Forbidden - super_admin only", status: 403 as const };
  }
  return { admin, caller: profile };
}
