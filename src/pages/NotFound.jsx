import { Link } from 'react-router-dom'
import { VoxelMark } from '../components/Brand.jsx'
export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl px-4 py-24 text-center">
      <VoxelMark className="mx-auto size-14" />
      <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">Страница не найдена</h1>
      <p className="mt-3 text-slate-400">Возможно, адрес введён с ошибкой или страница была удалена.</p>
      <Link to="/" className="btn-primary mt-8 min-h-12 px-6">На главную</Link>
    </section>
  )
}
