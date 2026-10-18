import { Link } from 'react-router-dom'
import { SERVER_NAME } from '../config/server.js'

// Изометрический куб — знак Tilliworld. Три грани: светлая сверху, фиолетовая слева, голубая справа.
export function VoxelMark({ className = 'size-8' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 3 28 10 16 17 4 10Z" fill="#c4b5fd" />
      <path d="M4 10 16 17V31L4 24Z" fill="#8b5cf6" />
      <path d="M28 10 16 17V31L28 24Z" fill="#2f9bff" />
    </svg>
  )
}

export function Logo({ to = '/', className = '' }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-2.5 rounded-block ${className}`} aria-label={`${SERVER_NAME} — на главную`}>
      <VoxelMark />
      <span className="font-display text-[0.95rem] font-semibold tracking-tight text-white">{SERVER_NAME}</span>
    </Link>
  )
}

// Лестница из кубов: декоративная иллюстрация первого экрана и экрана входа.
// Высоты столбиков задают форму; один кубик подсвечен голубым — единственный яркий акцент.
const HEIGHTS = [
  [4, 3, 2],
  [3, 2, 1],
  [2, 1, 1],
]
const HW = 30 // половина ширины ромба
const HH = 17 // половина высоты ромба
const CH = 34 // высота ребра куба

function buildCubes() {
  const cubes = []
  HEIGHTS.forEach((row, gx) => row.forEach((h, gy) => {
    for (let gz = 0; gz < h; gz += 1) cubes.push({ gx, gy, gz, top: gz === h - 1 })
  }))
  // от дальних к ближним, чтобы грани перекрывались правильно
  return cubes.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy) || a.gz - b.gz)
}
const CUBES = buildCubes()

export function VoxelCluster({ className = '' }) {
  return (
    <svg viewBox="-100 -72 200 252" className={className} aria-hidden="true" focusable="false">
      {CUBES.map(({ gx, gy, gz, top }) => {
        const x = (gx - gy) * HW
        const y = (gx + gy) * HH - gz * CH + 40
        const accent = gx === 0 && gy === 0 && gz === 3
        const topFill = accent ? '#7cc8ff' : top ? '#a78bfa' : '#3b3052'
        const leftFill = accent ? '#2f9bff' : '#2a2140'
        const rightFill = accent ? '#1d7ee8' : '#1d1830'
        return (
          <g key={`${gx}-${gy}-${gz}`} stroke="#09090d" strokeWidth="1" strokeLinejoin="round">
            <path d={`M${x} ${y} L${x + HW} ${y + HH} L${x} ${y + 2 * HH} L${x - HW} ${y + HH}Z`} fill={topFill} />
            <path d={`M${x - HW} ${y + HH} L${x} ${y + 2 * HH} L${x} ${y + 2 * HH + CH} L${x - HW} ${y + HH + CH}Z`} fill={leftFill} />
            <path d={`M${x + HW} ${y + HH} L${x} ${y + 2 * HH} L${x} ${y + 2 * HH + CH} L${x + HW} ${y + HH + CH}Z`} fill={rightFill} />
          </g>
        )
      })}
    </svg>
  )
}
