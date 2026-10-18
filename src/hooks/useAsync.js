import { useCallback, useEffect, useRef, useState } from 'react'

// Загрузка данных с защитой от гонки: ответ устаревшего запроса (например, после смены :id
// или размонтирования страницы) игнорируется. deps — массив примитивов, при изменении запрос повторяется.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const latest = useRef(0) // номер последнего запущенного запроса
  const fnRef = useRef(fn)
  fnRef.current = fn
  const key = JSON.stringify(deps)

  const run = useCallback(() => {
    const mine = ++latest.current
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(() => fnRef.current())
      .then((data) => { if (mine === latest.current) setState({ loading: false, error: null, data }) })
      .catch((e) => { if (mine === latest.current) setState({ loading: false, error: e.message || 'Ошибка', data: null }) })
  }, [])

  useEffect(() => {
    run()
    // Здесь ref — счётчик, а не DOM-узел, поэтому чтение в cleanup намеренно: обесцениваем запрос при размонтировании.
    return () => invalidate(latest)
  }, [run, key]) // key: повторный запрос при изменении deps

  return { ...state, reload: run }
}

function invalidate(counter) { counter.current += 1 }
