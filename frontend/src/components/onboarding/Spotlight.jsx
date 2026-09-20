import { useEffect, useState } from 'react'

/**
 * The dimmed overlay with a hole cut around the highlighted element.
 *
 * Four panels rather than an SVG mask or box-shadow ring: the panels are plain
 * divs whose geometry is written directly from a measured rect, so nothing
 * depends on a paint feature or an animation frame. This project's preview
 * environment does not reliably composite, and an overlay that fails to appear
 * would leave the tour pointing at nothing.
 *
 * Returns null when there is no rect — the caller then centres the tooltip and
 * the tour continues without a spotlight rather than breaking.
 */
export default function Spotlight({ rect, padding = 8 }) {
  const [vw, setVw] = useState(() => window.innerWidth)
  const [vh, setVh] = useState(() => window.innerHeight)

  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!rect) return null

  const top = Math.max(0, rect.top - padding)
  const left = Math.max(0, rect.left - padding)
  const right = Math.min(vw, rect.right + padding)
  const bottom = Math.min(vh, rect.bottom + padding)

  const panel = 'fixed bg-ink/45 transition-[top,left,width,height] duration-200 ' +
                'ease-out motion-reduce:transition-none'

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]">
      <div className={panel} style={{ top: 0, left: 0, width: vw, height: top }} />
      <div className={panel} style={{ top: bottom, left: 0, width: vw, height: Math.max(0, vh - bottom) }} />
      <div className={panel} style={{ top, left: 0, width: left, height: Math.max(0, bottom - top) }} />
      <div className={panel} style={{ top, left: right, width: Math.max(0, vw - right), height: Math.max(0, bottom - top) }} />

      {/* The ring around the cut-out. Border only, so it never obscures the UI. */}
      <div
        className="fixed rounded-card border-2 border-accent
                   transition-[top,left,width,height] duration-200 ease-out
                   motion-reduce:transition-none"
        style={{ top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }}
      />
    </div>
  )
}
