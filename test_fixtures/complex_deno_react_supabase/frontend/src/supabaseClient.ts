import { createClient } from '@supabase/supabase-js';

// Use placeholder values for the fixture - DO NOT HARDCODE REAL CREDENTIALS
const supabaseUrl = 'http://localhost:54321'; // Or placeholder URL
const supabaseAnonKey = 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);