import { supabase } from './supabase'

export type UserProfile = {
  name: string
  email: string
  role: 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'
}

export async function createUserProfile(data: UserProfile) {
  const { error } = await supabase
    .from('user_profiles')
    .insert(data)

  if (error) throw error
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