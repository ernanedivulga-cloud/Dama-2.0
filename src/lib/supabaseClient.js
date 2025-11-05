import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://dwqporoyzcanwiuxwcsr.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3cXBvcm95emNhbndpdXh3Y3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyODg5NjEsImV4cCI6MjA3Nzg2NDk2MX0.8rcxAH79wNqGRjxvBL1CI_uQNuGvFCfNpKff2CWJVP4'

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function registerUser(email, password) {
  const { user, error } = await supabase.auth.signUp({ email, password })
  return { user, error }
}

export async function loginUser(email, password) {
  const { user, error } = await supabase.auth.signInWithPassword({ email, password })
  return { user, error }
}

export async function logoutUser() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function saveMatchResult(player, result) {
  const { data, error } = await supabase.from('matches').insert([{ player, result }])
  return { data, error }
}
