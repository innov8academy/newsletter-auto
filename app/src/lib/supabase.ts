import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Basic validation to help debug if keys are missing
if (!supabaseUrl) {
    console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL is missing.');
    throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
}
if (!supabaseAnonKey) {
    console.error('ERROR: NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.');
    // We might not want to throw here if we want to allow build to pass, but the app won't work.
    // Let's throw to be safe.
    throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// 1. Client for client-side usage (public data, auth)
// Use this in components or client-side logic
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 2. Client for server-side usage (admin rights, bypassing RLS)
// CRITICAL: Only use this in API routes or server components! Never expose to client.
// We use this to write curated news, reading restricted data, etc.
export const supabaseAdmin = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : supabase; // Fallback to anon client if service key missing (will fail RLS if configured)

export const isSupabaseConfigured = () => {
    return !!(supabaseUrl && supabaseAnonKey && supabaseServiceKey);
};
