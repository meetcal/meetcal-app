import { supabase } from './supabase'

export type UserProfile = {
  id: string
  name: string | null
  email: string | null
  role: 'Athlete' | 'Coach' | 'Spectator' | null
  created_at: string
  updated_at: string
}

export async function createUserProfile(data: {
  name: string
  email: string
  role: 'Athlete' | 'Coach' | 'Spectator'
}) {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return profile
}

export async function getUserProfile(userId: string) {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) throw error
  return profile
}

export async function updateUserProfile(
  userId: string,
  data: Partial<Pick<UserProfile, 'name' | 'email' | 'role'>>
) {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .update(data)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return profile
} 