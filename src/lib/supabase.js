import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isCloudEnabled = Boolean(url && key);
export const supabase = isCloudEnabled
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
  : null;

// Every visitor receives a private, account-free Supabase identity.
// The browser stores the anonymous session; no name, email or phone is requested.
export async function ensureAnonymousSession() {
  if (!isCloudEnabled) return null;

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (session?.user) return session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data?.user) throw new Error("Could not start a private anonymous session.");
  return data.user;
}

export async function getCurrentUserId() {
  if (!isCloudEnabled) return null;
  const user = await ensureAnonymousSession();
  return user.id;
}
