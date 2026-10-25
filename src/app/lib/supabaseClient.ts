/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

/* ── The app's one connection to Supabase (project yeyfmyojdlqtgoqlwhsv) ───────
   URL + anon key come from .env.local (git-ignored). Vite only exposes vars that
   start with VITE_ to the browser, and it reads them at build/start time —
   restart `pnpm dev` after editing .env.local. Your hosting provider needs the
   same two variables set in its environment settings.

   The anon key is public by design. What it may do is decided entirely by the
   row-level-security policies in supabase/migrations, and by who is signed in.
   The service-role key must NEVER be put here or in any VITE_ variable.

   All queries live in ./db.ts — screens don't call `supabase` directly. */
const url     = import.meta.env.VITE_SUPABASE_URL     as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Add them to .env.local ' +
    '(and to your hosting provider\'s environment variables) and restart the dev server.'
  );
}

export const supabase = createClient(url, anonKey);

/* Dev-only convenience: lets you call supabase.from(...)/rpc(...) directly from the
   browser console to test RLS/guards as the signed-in user. Never included in a
   production build — import.meta.env.DEV is false and this branch is dropped. */
if (import.meta.env.DEV) (window as unknown as { supabase: typeof supabase }).supabase = supabase;
