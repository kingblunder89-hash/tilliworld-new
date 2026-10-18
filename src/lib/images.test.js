import { describe, it, expect } from 'vitest'
import { validateImage, MAX_IMAGE_BYTES } from './images.js'

const file = (bytes, name = 'f.png', type = 'image/png') => new File([new Uint8Array(bytes)], name, { type })
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]

describe('validateImage', () => {
  it('принимает PNG, JPEG и WebP по сигнатуре', async () => {
    expect(await validateImage(file(PNG))).toEqual({ type: 'image/png', ext: 'png' })
    expect(await validateImage(file(JPG, 'a.jpg', 'image/jpeg'))).toEqual({ type: 'image/jpeg', ext: 'jpg' })
    expect(await validateImage(file(WEBP, 'a.webp', 'image/webp'))).toEqual({ type: 'image/webp', ext: 'webp' })
  })
  it('определяет формат по содержимому, а не по расширению', async () => {
    expect((await validateImage(file(JPG, 'renamed.png', 'image/png'))).ext).toBe('jpg')
  })
  it('отклоняет исполняемый файл под видом картинки', async () => {
    await expect(validateImage(file([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'x.png'))).rejects.toThrow('PNG, JPEG и WebP')
  })
  it('отклоняет SVG и GIF', async () => {
    await expect(validateImage(file([0x3c, 0x73, 0x76, 0x67, 0x20, 0, 0, 0, 0, 0, 0, 0], 'a.svg', 'image/svg+xml'))).rejects.toThrow()
    await expect(validateImage(file([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0], 'a.gif', 'image/gif'))).rejects.toThrow()
  })
  it('отклоняет пустой и слишком большой файл', async () => {
    await expect(validateImage(file([]))).rejects.toThrow('пустой')
    await expect(validateImage(file([...PNG, ...new Array(MAX_IMAGE_BYTES)]))).rejects.toThrow('2 МБ')
  })
  it('отклоняет отсутствие файла', async () => {
    await expect(validateImage(null)).rejects.toThrow('не выбран')
  })
})
