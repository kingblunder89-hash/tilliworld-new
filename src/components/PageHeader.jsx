import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

// Заголовок страницы: название, пояснение и необязательные действия справа. Один вид на всём сайте.
export function PageHeader({ title, icon: Icon, children, actions }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-2xl">
        <h1 className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {Icon && <span className="grid size-10 shrink-0 place-items-center rounded-block border border-accent-400/25 bg-accent-500/10 text-accent-300"><Icon className="size-5" aria-hidden="true" /></span>}
          {title}
        </h1>
        {children && <p className="mt-3 leading-relaxed text-slate-400">{children}</p>}
      </div>
      {actions}
    </header>
  )
}

// Заголовок раздела внутри страницы со ссылкой «смотреть всё».
export function SectionHead({ title, to, linkLabel }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
      {to && (
        <Link to={to} className="group inline-flex items-center gap-1.5 text-sm font-medium text-accent-300 hover:text-accent-200">
          {linkLabel} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}
