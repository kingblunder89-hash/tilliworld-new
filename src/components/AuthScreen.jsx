import { Logo, VoxelCluster } from './Brand.jsx'

// Полноэкранная страница входа: слева знак проекта и приветствие, справа форма. Содержимое формы передаётся children.
export default function AuthScreen({ children }) {
  return (
    <main className="relative isolate min-h-screen overflow-hidden">
      <div className="bg-grid absolute inset-0 -z-10" aria-hidden="true" />
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <div className="mx-auto w-full max-w-md text-center lg:mx-0 lg:text-left">
          <div className="flex justify-center lg:justify-start"><Logo /></div>
          <p className="mt-8 font-display text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">Добро пожаловать в Tilliworld</p>
          <p className="mt-4 leading-relaxed text-slate-400">Чтобы продолжить, создайте аккаунт: нужны только ник и пароль.</p>
          <VoxelCluster className="mt-10 hidden h-64 w-auto lg:block" />
        </div>
        <div className="flex justify-center lg:justify-end">{children}</div>
      </div>
    </main>
  )
}
