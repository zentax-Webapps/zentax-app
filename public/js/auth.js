// Auth state - wraps Supabase Auth and keeps the user's profile (role, name)
// in memory.
//
// Persistence model (intentional - the user never gets logged out by
// closing the browser, refreshing, or transient network errors):
//   - Supabase stores the session (access + refresh tokens) in localStorage.
//   - We cache the profile row in localStorage so the UI can boot offline.
//   - autoRefreshToken: true silently rotates the access token in the
//     background; nothing visible happens to the user.
//   - We only clear local state when the user explicitly presses Sign Out
//     OR when the database confirms the account was deactivated by an admin
//     OR when Supabase Auth reports the refresh token itself is invalid.
import { sb } from './sb.js';

const PROFILE_CACHE_KEY = 'zentax_profile';

let currentUser = null;
const subs = new Set();

export function getUser() { return currentUser; }
export function onAuthChange(cb) { subs.add(cb); return () => subs.delete(cb); }
function emit() { subs.forEach(cb => { try { cb(currentUser); } catch {} }); }

function loadCachedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function cacheProfile(p) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p)); } catch {}
}
function clearCachedProfile() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
}

// Fetch the latest profile from the DB. Returns:
//   { ok: true, profile } on success
//   { ok: false, reason: 'inactive' }   - admin disabled the account
//   { ok: false, reason: 'missing' }    - profile row is gone (rare)
//   { ok: false, reason: 'transient' }  - network/etc; caller should keep cache
async function fetchProfile(authUserId) {
  try {
    const { data, error, status } = await sb.from('profiles')
      .select('id, email, full_name, role, phone, is_active')
      .eq('id', authUserId)
      .single();
    if (error) {
      // PGRST116 == row not found
      if (error.code === 'PGRST116' || status === 406) {
        return { ok: false, reason: 'missing' };
      }
      return { ok: false, reason: 'transient' };
    }
    if (!data.is_active) return { ok: false, reason: 'inactive' };
    return { ok: true, profile: data };
  } catch {
    return { ok: false, reason: 'transient' };
  }
}

async function applyAuthUser(authUser, { allowCache = true } = {}) {
  if (!authUser) { currentUser = null; clearCachedProfile(); return; }

  // 1. Show cached profile instantly (instant boot, works offline).
  const cached = loadCachedProfile();
  if (allowCache && cached && cached.id === authUser.id) {
    currentUser = cached;
  }

  // 2. Refresh from DB in the background.
  const res = await fetchProfile(authUser.id);
  if (res.ok) {
    currentUser = res.profile;
    cacheProfile(res.profile);
  } else if (res.reason === 'inactive') {
    // Admin disabled the account: hard sign-out.
    await sb.auth.signOut().catch(() => {});
    currentUser = null;
    clearCachedProfile();
  } else if (res.reason === 'missing') {
    // Profile row truly gone (e.g. cleanup). Sign out.
    await sb.auth.signOut().catch(() => {});
    currentUser = null;
    clearCachedProfile();
  } else {
    // Transient: keep whatever we had (cached or null). Do NOT sign out.
  }
}

export async function bootstrap() {
  const { data } = await sb.auth.getSession();
  await applyAuthUser(data.session?.user ?? null);
  emit();

  // React to auth events. Note we DO NOT reload the profile on TOKEN_REFRESHED
  // events - the access token rotated but the user is unchanged.
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      clearCachedProfile();
      emit();
      return;
    }
    if (event === 'TOKEN_REFRESHED') return;        // silent
    if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
      await applyAuthUser(session?.user ?? null);
      emit();
    }
  });
  return currentUser;
}

export async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password: String(password),
  });
  if (error) throw new Error(error.message);
  await applyAuthUser(data.user, { allowCache: false });
  emit();
  return currentUser;
}

export async function logout() {
  await sb.auth.signOut().catch(() => {});
  currentUser = null;
  clearCachedProfile();
  emit();
}

export async function changePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export function isOfficeSide(role = currentUser?.role) {
  return ['super_admin','admin','team_member'].includes(role);
}
export function isClientSide(role = currentUser?.role) {
  return ['client_owner','client_executive'].includes(role);
}
export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  team_member: 'Team Member',
  client_owner: 'Client - Owner',
  client_executive: 'Client - Executive',
};
