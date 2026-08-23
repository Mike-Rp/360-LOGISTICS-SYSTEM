import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '/utils/supabase/info';

export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey
);

export const SERVER = `https://${projectId}.supabase.co/functions/v1/make-server-ee4d169c`;
