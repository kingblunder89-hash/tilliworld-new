import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// isAdmin здесь — только для интерфейса. Реальную защиту обеспечивает RLS в базе.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  const isAdmin = session?.user?.app_metadata?.role === 'admin'
  return { session, loading, isAdmin }
}
