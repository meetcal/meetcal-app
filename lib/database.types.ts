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
          user_id: string
          name: string | null
          email: string | null
          role: 'Athlete' | 'Coach' | 'Spectator' | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name?: string | null
          email?: string | null
          role?: 'Athlete' | 'Coach' | 'Spectator' | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string | null
          email?: string | null
          role?: 'Athlete' | 'Coach' | 'Spectator' | null
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
} 