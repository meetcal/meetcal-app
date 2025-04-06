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
      meets: {
        Row: {
          id: string
          name: string
          venue_name: string
          venue_street: string
          venue_city: string
          venue_state: string
          venue_zip: string
          time_zone: string
          start_date: string
          end_date: string
          status: 'upcoming' | 'ongoing' | 'completed'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          venue_name: string
          venue_street: string
          venue_city: string
          venue_state: string
          venue_zip: string
          time_zone: string
          start_date: string
          end_date: string
          status?: 'upcoming' | 'ongoing' | 'completed'
        }
        Update: {
          name?: string
          venue_name?: string
          venue_street?: string
          venue_city?: string
          venue_state?: string
          venue_zip?: string
          time_zone?: string
          start_date?: string
          end_date?: string
          status?: 'upcoming' | 'ongoing' | 'completed'
        }
      }
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