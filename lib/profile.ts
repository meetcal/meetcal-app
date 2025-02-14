import { supabase } from './supabase'

export type UserProfile = {
  id: string
  name: string | null
  email: string | null
  role: 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media' | null
  created_at: string
  updated_at: string
}

export async function createUserProfile(data: {
  name: string
  email: string
  role: 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'
}) {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .insert(data)
    .select()
    .single()

  if (error) throw error
  return profile
}

export async function getUserProfile() {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('*')
    .limit(1)
    .single()

  if (error) throw error
  return profile
}

export async function updateUserProfile(
  id: string,
  data: Partial<Pick<UserProfile, 'name' | 'email' | 'role'>>
) {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .update(data)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return profile
} 