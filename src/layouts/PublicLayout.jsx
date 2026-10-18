import { Outlet, useLocation } from 'react-router-dom'
import Header from '../components/Header.jsx'
import Footer from '../components/Footer.jsx'
import AuthForm from '../components/AuthForm.jsx'
import AuthScreen from '../components/AuthScreen.jsx'
import { usePlayer } from '../hooks/usePlayer.js'
import { isSupabaseConfigured } from '../lib/supabase.js'

// Вход на сайт: без аккаунта показывается только регистрация (ник и пароль). Без настроенной базы (демо-режим) сайт открыт.
export default function PublicLayout() {
  const token = usePlayer()
  const { pathname } = useLocation()
  if (isSupabaseConfigured && !token) {
    return (
      <AuthScreen>
        <AuthForm defaultMode="signup" />
      </AuthScreen>
    )
  }
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-block focus:bg-accent-600 focus:px-4 focus:py-2 focus:font-semibold focus:text-white">К содержимому</a>
      <Header />
      <main id="main" className="flex-1">
        <div key={pathname} className="page-enter"><Outlet /></div>
      </main>
      <Footer />
    </div>
  )
}
