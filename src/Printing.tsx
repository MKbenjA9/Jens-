import { useEffect, useMemo, useState } from 'react'
import { Download, Printer, Ruler } from 'lucide-react'
import './printing.css'

type XY = { x: number; y: number }
type Entity = (XY & { id: string; type: 'point' }) | (XY & { id: string; type: 'line'; x2: number; y2: number; markType?: string; label?: string }) | (XY & { id: string; type: 'curve'; cx: number; cy: number; x2: number; y2: number }) | { id: string; type: 'piece'; vertices: XY[]; label?: string; seamAllowanceMm?: number }
type Pattern = { id: number; name: string; updated_at: string; product_name?: string | null }
type Detail = { id: number; name: string; geometry: { items: Entity[]; reference_images?: { calibrated: boolean }[]; photo_derived?: boolean; photo_scale_calibrated?: boolean } }
type Bounds = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }
type Tile = { row: number; col: number; x: number; y: number }

const margin = 10, header = 18, footer = 8
function entityPoints(e: Entity): XY[] {
  if (e.type === 'piece') return (e.seamAllowanceMm??0)>0 ? [...e.vertices,...offsetPiece(e.vertices,e.seamAllowanceMm??0)] : e.vertices
  if (e.type === 'line' || e.type === 'curve') return [{ x: e.x, y: e.y }, { x: e.x2, y: e.y2 }, ...(e.type === 'curve' ? [{ x: e.cx, y: e.cy }] : [])]
  return [{ x: e.x, y: e.y }]
}
function bounds(items: Entity[]): Bounds {
  const points = items.flatMap(entityPoints)
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y)), maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y))
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}
function offsetPiece(points: XY[], amount: number): XY[] {
  const area=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y},0)
  return points.map((point,i)=>{const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length],n1={x:(point.y-prev.y)*(area>0?1:-1),y:(prev.x-point.x)*(area>0?1:-1)},n2={x:(next.y-point.y)*(area>0?1:-1),y:(point.x-next.x)*(area>0?1:-1)},l1=Math.hypot(n1.x,n1.y)||1,l2=Math.hypot(n2.x,n2.y)||1,u1={x:n1.x/l1,y:n1.y/l1},u2={x:n2.x/l2,y:n2.y/l2},n={x:u1.x+u2.x,y:u1.y+u2.y},ln=Math.hypot(n.x,n.y)||1,b={x:n.x/ln,y:n.y/ln},s=amount/Math.max(.25,b.x*u2.x+b.y*u2.y);return{x:point.x+b.x*s,y:point.y+b.y*s}})
}
function xml(value: string) { return value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]!) ) }
function svgEntity(e: Entity) {
  if (e.type === 'point') return `<circle cx="${e.x}" cy="${e.y}" r="1.2"/>`
  if (e.type === 'line') return `<path d="M ${e.x} ${e.y} L ${e.x2} ${e.y2}" ${e.markType ? 'stroke-dasharray="8 5"' : ''}/>${e.label ? `<text x="${(e.x+e.x2)/2}" y="${(e.y+e.y2)/2}" fill="#111" stroke="none" font-size="18">${xml(e.label)}</text>` : ''}`
  if (e.type === 'curve') return `<path d="M ${e.x} ${e.y} Q ${e.cx} ${e.cy} ${e.x2} ${e.y2}"/>`
  const border=(e.seamAllowanceMm??0)>0?`<polygon points="${offsetPiece(e.vertices,e.seamAllowanceMm??0).map(p=>`${p.x},${p.y}`).join(' ')}" stroke="#d68041" stroke-dasharray="8 5"/>`:''
  const label=e.label?`<text x="${e.vertices.reduce((s,p)=>s+p.x,0)/e.vertices.length}" y="${e.vertices.reduce((s,p)=>s+p.y,0)/e.vertices.length}" text-anchor="middle" fill="#111" stroke="none" font-size="18">${xml(e.label)}</text>`:''
  return `<polygon points="${e.vertices.map(p => `${p.x},${p.y}`).join(' ')}"/>${border}${label}`
}
function patternSvg(items: Entity[], b: Bounds, calibration = false) {
  const extra = calibration ? 120 : 0, width = Math.max(b.width, calibration ? 120 : 1), height = b.height + extra
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><g transform="translate(${-b.minX} ${-b.minY})" fill="none" stroke="#111" stroke-width="0.6" vector-effect="non-scaling-stroke">${items.map(svgEntity).join('')}</g>${calibration ? `<g transform="translate(10 ${b.height + 10})" fill="none" stroke="#111" stroke-width="0.5"><rect width="100" height="100"/><path d="M0 50h100M50 0v100"/><text x="0" y="-3" fill="#111" stroke="none" font-size="4">Control: 100 × 100 mm</text></g>` : ''}</svg>`
}
function download(name: string, content: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' })); a.download = name.replace(/[^\p{L}\p{N}_-]+/gu, '_') + '.svg'; a.click(); URL.revokeObjectURL(a.href)
}
function cross(x: number, y: number) { return `<g stroke="#555" stroke-width="0.25"><path d="M${x - 3} ${y}h6 M${x} ${y - 3}v6"/><circle cx="${x}" cy="${y}" r="1.3" fill="white"/></g>` }

export default function PrintingPage() {
  const [patterns, setPatterns] = useState<Pattern[]>([]), [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null), [paper, setPaper] = useState<'A4' | 'A3'>('A4'), [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait'), [overlap, setOverlap] = useState(10), [error, setError] = useState('')
  useEffect(() => { fetch('/api/patterns').then(r => r.json()).then((rows: Pattern[]) => { setPatterns(rows); if (rows.length) setSelectedId(rows[0].id) }).catch(() => setError('No se pudo cargar la lista de moldes.')) }, [])
  useEffect(() => { if (!selectedId) { setDetail(null); return } fetch(`/api/patterns/${selectedId}`).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<Detail> }).then(setDetail).catch(() => setError('No se pudo cargar la geometría del molde.')) }, [selectedId])
  const items = detail?.geometry?.items ?? []
  const images = detail?.geometry?.reference_images ?? []
  const scaleReady = images.every(image => image.calibrated) && !(detail?.geometry.photo_derived && !detail.geometry.photo_scale_calibrated)
  const b = useMemo(() => items.length ? bounds(items) : null, [items])
  let pageW = paper === 'A4' ? 210 : 297, pageH = paper === 'A4' ? 297 : 420
  if (orientation === 'landscape') [pageW, pageH] = [pageH, pageW]
  const innerW = pageW - 2 * margin, innerH = pageH - header - footer - margin
  const stepX = Math.max(1, innerW - overlap), stepY = Math.max(1, innerH - overlap)
  const cols = b ? Math.max(1, Math.ceil(Math.max(0, b.width - innerW) / stepX) + 1) : 0
  const rows = b ? Math.max(1, Math.ceil(Math.max(0, b.height - innerH) / stepY) + 1) : 0
  const tiles: Tile[] = b ? Array.from({ length: rows * cols }, (_, i) => ({ row: Math.floor(i / cols), col: i % cols, x: b.minX + (i % cols) * stepX, y: b.minY + Math.floor(i / cols) * stepY })) : []
  const paperCss = { width: `${pageW}mm`, height: `${pageH}mm` }
  function tileSvg(tile: Tile) {
    const clipId = `clip-${tile.row}-${tile.col}`
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}"><defs><clipPath id="${clipId}"><rect x="${margin}" y="${header}" width="${innerW}" height="${innerH}"/></clipPath></defs><rect width="100%" height="100%" fill="white"/><text x="${margin}" y="10" font-size="4" font-family="sans-serif">${xml(detail?.name ?? '')} · Hoja ${tile.row + 1}-${tile.col + 1} de ${rows}×${cols} · ${paper}</text><g transform="translate(${margin - tile.x} ${header - tile.y})" clip-path="url(#${clipId})" fill="none" stroke="#111" stroke-width="0.6" vector-effect="non-scaling-stroke">${items.map(svgEntity).join('')}</g>${cross(margin, header)}${cross(margin + innerW, header)}${cross(margin, header + innerH)}${cross(margin + innerW, header + innerH)}<text x="${margin}" y="${pageH - 4}" font-size="3" font-family="sans-serif">Unir por las marcas · Solape ${overlap} mm · Imprimir al 100%</text></svg>`
  }
  return <div className="printing-page">
    <div className="printing-head"><div><span className="print-eyebrow">ETAPA 05 · SALIDA A TAMAÑO REAL</span><h1>Impresión profesional</h1><p>Divide el molde en hojas imprimibles con solape y marcas para unir las páginas.</p></div><button className="print-action" disabled={!items.length || !scaleReady} onClick={() => window.print()}><Printer size={16}/> Imprimir / Guardar PDF</button></div>
    <section className="print-controls"><label>Molde<select value={selectedId ?? ''} onChange={e => setSelectedId(Number(e.target.value) || null)}><option value="">Selecciona un molde</option>{patterns.map(p => <option key={p.id} value={p.id}>{p.name}{p.product_name ? ` · ${p.product_name}` : ''}</option>)}</select></label><label>Papel<select value={paper} onChange={e => setPaper(e.target.value as 'A4'|'A3')}><option>A4</option><option>A3</option></select></label><label>Orientación<select value={orientation} onChange={e => setOrientation(e.target.value as 'portrait'|'landscape')}><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label><label>Solape (mm)<input type="number" min="0" max="40" value={overlap} onChange={e => setOverlap(Math.max(0, Math.min(40, Number(e.target.value))))}/></label></section>
    {error && <p className="print-error">{error}</p>}
    {b ? <>
      <section className="print-summary">
        <div><strong>{detail?.name}</strong><span>{b.width.toFixed(0)} × {b.height.toFixed(0)} mm · {items.length} elementos</span></div>
        <div><strong>{cols * rows} hojas</strong><span>{cols} columnas × {rows} filas · {paper} {orientation === 'portrait' ? 'vertical' : 'horizontal'}</span></div>
        <button className="export-svg" disabled={!scaleReady} onClick={() => download(detail?.name ?? 'molde', patternSvg(items, b, true))}><Download size={15}/> Descargar SVG 1:1 + control</button>
      </section>
      {!scaleReady && <div className="print-note print-warning"><Ruler size={17}/><span>Hay fotografías de referencia sin calibrar. Vuelve al editor, calibra cada foto o elimínala antes de exportar o imprimir a escala real.</span></div>}
      <div className="print-note"><Ruler size={17}/><span>En el diálogo de impresión elige <b>tamaño real / 100%</b>, mismo tamaño de papel y márgenes cero o mínimos. Comprueba que el cuadrado mida 10 × 10 cm antes de cortar.</span></div>
      <div className="tile-preview">
        <div className="tile-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(78px, 1fr))` }}>
          {tiles.map(t => <div className="tile-card" key={`${t.row}-${t.col}`}><span>{t.row + 1}-{t.col + 1}</span><svg viewBox={`0 0 ${innerW} ${innerH}`}><g transform={`translate(${-t.col * stepX} ${-t.row * stepY})`} fill="none" stroke="#273649" strokeWidth="1.2">{items.map((e, i) => <g key={i} dangerouslySetInnerHTML={{ __html: svgEntity(e) }}/>)}</g></svg></div>)}
        </div>
        <button className="export-svg" disabled={!scaleReady} onClick={() => download(`${detail?.name ?? 'molde'}_mosaico`, tiles.map(tileSvg).join('\n'))}><Download size={15}/> Descargar páginas SVG</button>
      </div>
      <div className="plotter-print" aria-hidden="true">
        <style>{`@page { size: ${paper} ${orientation}; margin: 0 }`}</style>
        {tiles.map((t, i) => <div key={i} className="print-page" style={paperCss} dangerouslySetInnerHTML={{ __html: tileSvg(t) }} />)}
        <div className="print-page calibration-page" style={paperCss}><svg xmlns="http://www.w3.org/2000/svg" width={`${pageW}mm`} height={`${pageH}mm`} viewBox={`0 0 ${pageW} ${pageH}`}><text x="20" y="30" fontSize="6">Control de escala</text><rect x="20" y="45" width="100" height="100" fill="none" stroke="black" strokeWidth="0.5"/><text x="20" y="155" fontSize="4">Este cuadrado debe medir exactamente 10 × 10 cm.</text><text x="20" y="165" fontSize="4">Imprime al 100%, sin ajustar a página.</text></svg></div>
      </div>
    </> : <div className="print-empty">{patterns.length ? 'Elige un molde que tenga geometría para preparar sus hojas.' : 'Primero guarda un molde desde el editor.'}</div>}
  </div>
}
