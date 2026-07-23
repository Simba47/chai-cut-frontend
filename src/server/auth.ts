import { createServiceClient } from '@/lib/supabase/server'

// Returns the authenticated user or null. Routes call this and return 401 on null.
export async function requireUser() {
  const client = await createServiceClient()
  const { data: { user } } = await client.auth.getUser()
  return user ?? null
}
