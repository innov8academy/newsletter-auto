import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Basic validation to help debug if keys are missing
if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase keys are missing in environment variables. Persistence will be disabled.');
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
