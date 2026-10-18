// Проверка изображений перед загрузкой в Supabase Storage.
// Клиентская проверка — для удобства; настоящие ограничения (тип, размер, права) задаёт bucket и RLS в миграции 002.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// Определяем формат по сигнатуре файла, а не по расширению или заявленному MIME.
async function sniffType(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const eq = (off, bytes) => bytes.every((v, i) => b[off + i] === v)
  if (eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (eq(0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (eq(0, [0x52, 0x49, 0x46, 0x46]) && eq(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp'
  return null
}

// Возвращает { type, ext } или бросает Error с понятным сообщением.
export async function validateImage(file) {
  if (!file) throw new Error('Файл не выбран.')
  if (file.size === 0) throw new Error('Файл пустой.')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Файл слишком большой: максимум 2 МБ.')
  const type = await sniffType(file)
  if (!type || !IMAGE_TYPES[type]) throw new Error('Допустимы только PNG, JPEG и WebP.')
  return { type, ext: IMAGE_TYPES[type] }
}
