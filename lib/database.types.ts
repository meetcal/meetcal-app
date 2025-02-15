export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string
          name: string
          email: string
          role: 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          email: string
          role: 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'
        }
        Update: {
          name?: string
          email?: string
          role?: 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'
        }
      }
    }
  }
} 