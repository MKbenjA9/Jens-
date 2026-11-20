import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ArrowDownToLine, ArrowUpRight, ClipboardList, Copy, FileCheck2, FileText, Plus, Printer, Save, Trash2 } from 'lucide-react'
import './sheets.css'
import SheetDesigner, { type Layout as SheetLayout } from './SheetDesigner'

type Product = { id: number; code: string; name: string }
type SheetKind = 'construction' | 'measurement'
type SheetMeta = { id: number; kind: SheetKind; version: number; created_at: string }
type Operation = { id: string; order: number; name: string; description: string; stitch_type: string; notes: string }
type SheetContent = {
  product?: { code: string; name: string; category?: string; description?: string; notes?: string; reference_image?: string | null }
  materials?: { name: string; kind: string; color: string; composition: string; quantity: number | null; quantity_kind?: string; unit: string }[]
  patterns?: { pattern_id: number; name: string; entity_count: number }[]
  operations?: Operation[]
  observations?: string
  sizes?: { id: number; name: string }[]
  measurements?: { id: number; name: string; description: string; tolerance_cm: number | null }[]
  values?: Record<string, Record<string, number>>
  drawings?: { front: string | null; back: string | null }
  layout?: SheetLayout
}
type Sheet = SheetMeta & { product_id: number; content: SheetContent }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'No se pudo completar la operación') }
  return response.json() as Promise<T>
}

export function SheetsPage({ onProducts }: { onProducts: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState('')
  const [kind, setKind] = useState<SheetKind>('construction')
  const [sheets, setSheets] = useState<SheetMeta[]>([])
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const revision = useRef(0)

  useEffect(() => {
    request<Product[]>('/api/products').then((rows) => { setProducts(rows); if (rows[0]) setProductId(String(rows[0].id)) }).catch((reason) => setError(reason.message))
  }, [])

  const loadSheet = async (id: number) => {
    try { const data = await request<Sheet>(`/api/sheets/${id}`); revision.current++; setSheet(data); setDirty(false); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo abrir la ficha') }
  }

  const loadList = async (id: string, sheetKind: SheetKind) => {
    if (!id) { setSheets([]); setSheet(null); return }
    try {
      const rows = await request<SheetMeta[]>(`/api/products/${id}/sheets`)
      const filtered = rows.filter((entry) => entry.kind === sheetKind).sort((a, b) => b.version - a.version)
      setSheets(filtered)
      if (filtered[0]) await loadSheet(filtered[0].id)
      else setSheet(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar la lista de fichas') }
  }
  useEffect(() => { void loadList(productId, kind) }, [productId, kind])

  const generate = async () => {
    if (!productId) return
    if(dirty&&sheet&&!(await saveCurrent()))return
    setBusy(true)
    try {
      const saved = await request<SheetMeta>(`/api/products/${productId}/sheets/${kind}/generate`, { method: 'POST' })
      await loadList(productId, kind); await loadSheet(saved.id); setNotice('Ficha generada desde los datos registrados')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo generar la ficha') }
    finally { setBusy(false) }
  }

  const saveNewVersion = async () => {
    if (!productId || !sheet) return
    if(dirty&&!(await saveCurrent()))return
    setBusy(true)
    try {
      const saved = await request<SheetMeta>(`/api/products/${productId}/sheets/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: sheet.content }) })
      await loadList(productId, kind); await loadSheet(saved.id); setNotice(`Guardada como versión ${saved.version}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la versión') }
    finally { setBusy(false) }
  }

  const updateContent = (change: Partial<SheetContent>) => { revision.current++; setDirty(true); setSheet((current) => current ? { ...current, content: { ...current.content, ...change } } : current) }
  const saveCurrent = async (snapshot=sheet, saveRevision=revision.current): Promise<boolean> => {
    if (!snapshot) return false
    setSaving(true)
    try {
      const saved = await request<Sheet>(`/api/sheets/${snapshot.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:snapshot.content}) })
      if (saveRevision===revision.current) { setSheet(saved); setDirty(false); setError(''); setNotice('Ficha guardada correctamente') }
      return true
    } catch (reason) { setError(reason instanceof Error ? `No se pudo guardar la ficha: ${reason.message}` : 'No se pudo guardar la ficha'); return false }
    finally { setSaving(false) }
  }
  useEffect(() => {
    if (!dirty || !sheet) return
    const snapshot=sheet,saveRevision=revision.current,timer=window.setTimeout(()=>{void saveCurrent(snapshot,saveRevision)},700)
    return ()=>window.clearTimeout(timer)
  }, [dirty,sheet])
  const printSheet = async () => {
    if (dirty && !(await saveCurrent())) return
    const printable=document.querySelector<HTMLElement>('.designer-print-content')
    const canvas=document.querySelector<HTMLElement>('.design-page')
    if(!printable||!canvas){setError('No se encontró el lienzo completo de la ficha para imprimir.');return}
    await document.fonts.ready
    const imagesLoaded=await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>('.sheet-paper img')).map(image=>image.decode().then(()=>image.naturalWidth>0).catch(()=>false)))
    if(imagesLoaded.some(loaded=>!loaded)){setError('No se pudo cargar una o más imágenes de la ficha. Corrige la imagen antes de exportar.');return}
    const page=canvas.getBoundingClientRect(),elements=Array.from(canvas.querySelectorAll<HTMLElement>('.design-element'))
    const outside=elements.some(element=>{const r=element.getBoundingClientRect();return r.left<page.left-1||r.top<page.top-1||r.right>page.right+1||r.bottom>page.bottom+1})
    const overflow=Array.from(canvas.querySelectorAll<HTMLElement>('.design-element,.design-text,.design-element td')).some(element=>element.scrollHeight>element.clientHeight+2||element.scrollWidth>element.clientWidth+2)
    if(outside){setError('Hay elementos fuera del tamaño de página. Muévelos o redúcelos antes de exportar.');return}
    if(overflow){setError('Hay contenido que no cabe en algunos recuadros o celdas. Amplíalos antes de exportar para evitar omisiones.');return}
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    setError('');window.print()
  }
  const updateImage = (side: 'front' | 'back', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2_000_000) { setError('Usa PNG, JPG o WebP de hasta 2 MB'); return }
    const reader = new FileReader()
    reader.onload = () => { revision.current++;setDirty(true);setSheet(current=>current?{...current,content:{...current.content,drawings:{front:current.content.drawings?.front??null,back:current.content.drawings?.back??null,[side]:String(reader.result)}}}:current) }
    reader.onerror = () => setError('No se pudo leer el dibujo')
    reader.readAsDataURL(file)
  }
  const chooseVersion = async (value: string) => { if(value){if(dirty&&sheet&&!(await saveCurrent()))return;await loadSheet(Number(value))} }
  const changeProduct = async (id:string) => { if(dirty&&sheet&&!(await saveCurrent()))return;setProductId(id) }
  const changeKind = async (next:SheetKind) => { if(dirty&&sheet&&!(await saveCurrent()))return;setKind(next) }
  const addOperation = () => {
    if (!sheet) return
    const operations = sheet.content.operations ?? []
    updateContent({ operations: [...operations, { id: crypto.randomUUID(), order: operations.length + 1, name: '', description: '', stitch_type: '', notes: '' }] })
  }
  const editOperation = (operationId: string, change: Partial<Operation>) => {
    if (!sheet) return
    updateContent({ operations: (sheet.content.operations ?? []).map((operation) => operation.id === operationId ? { ...operation, ...change } : operation) })
  }
  const removeOperation = (operationId: string) => {
    if (!sheet) return
    updateContent({ operations: (sheet.content.operations ?? []).filter((operation) => operation.id !== operationId).map((operation, index) => ({ ...operation, order: index + 1 })) })
  }
  const editMeasurement = (measurementId: number, sizeId: number, value: string) => {
    if (!sheet) return
    const values = { ...(sheet.content.values ?? {}) }
    values[String(measurementId)] = { ...(values[String(measurementId)] ?? {}) }
    if (value === '') delete values[String(measurementId)][String(sizeId)]
    else values[String(measurementId)][String(sizeId)] = Number(value)
    updateContent({ values })
  }

  const currentProduct = products.find((product) => String(product.id) === productId)
  const title = kind === 'construction' ? 'Ficha de confección' : 'Ficha de determinación'

  return <div className="management-page sheets-page"><div className="management-heading"><div><div className="module-breadcrumb">ESPACIO DE TRABAJO <span>/</span> FICHAS TÉCNICAS</div><h1>Fichas técnicas</h1><p>Genera documentos desde el producto y completa a mano los datos del taller.</p></div></div>
    {error && <div className="inline-error" role="alert">{error}</div>}{notice && <div className="inline-note">{notice}</div>}
    {!products.length ? <div className="management-empty"><FileText size={24} /><strong>Primero crea un producto</strong><span>Las fichas se construyen desde los datos de un modelo.</span><button onClick={onProducts}>Ir a productos <ArrowUpRight size={14} /></button></div> : <>
      <div className="sheet-controls"><label className="product-picker">Producto<select value={productId} onChange={(e) => void changeProduct(e.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}</select></label><div className="sheet-tabs"><button className={kind === 'construction' ? 'active' : ''} onClick={() => void changeKind('construction')}><ClipboardList size={15} /> Confección</button><button className={kind === 'measurement' ? 'active' : ''} onClick={() => void changeKind('measurement')}><FileCheck2 size={15} /> Determinación</button></div></div>
      <div className="sheet-toolbar"><div><strong>{title}</strong><span>{sheet ? `Versión ${sheet.version} · ${new Date(sheet.created_at).toLocaleString('es-CL')} · ${saving?'Guardando…':dirty?'Cambios pendientes':'Guardado'}` : 'Aún no generada'}</span></div><div className="sheet-toolbar-actions">{sheets.length > 0 && <select aria-label="Versión de la ficha" value={sheet?.id ?? ''} onChange={(e) => chooseVersion(e.target.value)}>{sheets.map((entry) => <option key={entry.id} value={entry.id}>Versión {entry.version} · {new Date(entry.created_at).toLocaleDateString('es-CL')}</option>)}</select>}<button className="secondary-button" onClick={generate} disabled={busy}><ArrowDownToLine size={14} /> Generar desde producto</button>{sheet && <button className="secondary-button" onClick={()=>void saveCurrent()} disabled={saving||!dirty}><Save size={14} /> Guardar ficha</button>}{sheet && <button className="secondary-button" onClick={saveNewVersion} disabled={busy}><Copy size={14} /> Guardar nueva versión</button>}{sheet && <button className="primary-button" onClick={()=>void printSheet()} disabled={saving}><Printer size={14} /> Exportar PDF / Imprimir</button>}</div></div>
      {!sheet ? <div className="management-empty sheet-empty"><FileText size={24} /><strong>Esta ficha todavía no existe</strong><span>Se creará con la información disponible de {currentProduct?.name} y podrás completarla.</span><button className="primary-button" onClick={generate} disabled={busy}>Generar ficha de {kind === 'construction' ? 'confección' : 'determinación'}</button></div> : <SheetPreview kind={kind} sheet={sheet} updateContent={updateContent} addOperation={addOperation} editOperation={editOperation} removeOperation={removeOperation} editMeasurement={editMeasurement} updateImage={updateImage} onDuplicate={saveNewVersion} onPrint={printSheet} />}
    </>}
  </div>
}

function SheetPreview({ kind, sheet, updateContent, addOperation, editOperation, removeOperation, editMeasurement, updateImage, onDuplicate, onPrint }: {
  kind: SheetKind; sheet: Sheet; updateContent: (change: Partial<SheetContent>) => void; addOperation: () => void; editOperation: (id: string, change: Partial<Operation>) => void; removeOperation: (id: string) => void; editMeasurement: (measurementId: number, sizeId: number, value: string) => void; updateImage: (side: 'front' | 'back', event: ChangeEvent<HTMLInputElement>) => void; onDuplicate: () => void; onPrint:()=>void
}) {
  const product = sheet.content.product
  return <article className="sheet-paper">
    {kind==='construction'&&<SheetDesigner sheet={sheet} updateContent={updateContent} onDuplicate={onDuplicate} onPrint={onPrint}/>}
    <header className={`sheet-paper-header ${kind==='construction'?'designer-screen-only':''}`}><div>{product?.reference_image ? <img src={product.reference_image} alt="Referencia del modelo" /> : <span className="sheet-brand-mark">P</span>}<div><span className="sheet-kicker">{kind === 'construction' ? 'ORDEN DE CONFECCIÓN' : 'ESPECIFICACIÓN DE MEDIDAS'}</span><h2>{product?.name || 'Producto'}</h2><span>{product?.code} · {product?.category || 'Sin categoría'}</span></div></div><div className="sheet-meta"><span>Versión {sheet.version}</span><span>{new Date(sheet.created_at).toLocaleDateString('es-CL')}</span></div></header>
    {product?.description && <p className={`sheet-description ${kind==='construction'?'designer-screen-only':''}`}>{product.description}</p>}
    {kind === 'construction' ? <div className="screen-only">
      <section className="sheet-section"><h3>Materiales e insumos</h3>{sheet.content.materials?.length ? <table className="sheet-table"><thead><tr><th>Material</th><th>Tipo</th><th>Color / composición</th><th>Cantidad</th><th>Origen</th></tr></thead><tbody>{sheet.content.materials.map((material, index) => <tr key={`${material.name}-${index}`}><td>{material.name}</td><td>{material.kind}</td><td>{[material.color, material.composition].filter(Boolean).join(' · ') || '—'}</td><td>{material.quantity == null ? 'Pendiente' : `${material.quantity} ${material.unit}`} {material.quantity_kind === 'estimated' ? '(estimado)' : ''}</td><td>{material.quantity_kind === 'estimated' ? 'Estimación' : 'Registro manual'}</td></tr>)}</tbody></table> : <p className="sheet-empty-line">Sin materiales asociados.</p>}</section>
      <section className="sheet-section"><div className="sheet-section-title"><h3>Operaciones de confección</h3><button className="secondary-button screen-only" onClick={addOperation}><Plus size={13} /> Añadir operación</button></div>{sheet.content.operations?.length ? <div className="operation-list">{sheet.content.operations.map((operation) => <div className="operation-card" key={operation.id}><div className="operation-number">{operation.order}</div><div className="operation-fields"><input className="operation-name" aria-label={`Nombre operación ${operation.order}`} value={operation.name} onChange={(e) => editOperation(operation.id, { name: e.target.value })} placeholder="Nombre de la operación" /><div className="operation-fields-row"><input value={operation.description} onChange={(e) => editOperation(operation.id, { description: e.target.value })} placeholder="Descripción e instrucciones" aria-label={`Descripción operación ${operation.order}`} /><input value={operation.stitch_type} onChange={(e) => editOperation(operation.id, { stitch_type: e.target.value })} placeholder="Tipo de costura" aria-label={`Tipo de costura operación ${operation.order}`} /></div><input value={operation.notes} onChange={(e) => editOperation(operation.id, { notes: e.target.value })} placeholder="Terminaciones / observaciones" aria-label={`Observaciones operación ${operation.order}`} /></div><button className="remove-operation screen-only" aria-label={`Eliminar operación ${operation.order}`} onClick={() => removeOperation(operation.id)}><Trash2 size={14} /></button></div>)}</div> : <p className="sheet-empty-line">Agrega aquí la secuencia real de costura del taller.</p>}</section>
      <section className="sheet-section"><div className="sheet-section-title"><h3>Moldes asociados</h3><span className="sheet-count">{sheet.content.patterns?.length ?? 0} molde{sheet.content.patterns?.length === 1 ? '' : 's'}</span></div>{sheet.content.patterns?.length ? <div className="pattern-summary-grid">{sheet.content.patterns.map((pattern) => <div className="pattern-summary" key={pattern.pattern_id}><FileText size={16} /><span><strong>{pattern.name}</strong><small>{pattern.entity_count} elementos geométricos</small></span></div>)}</div> : <p className="sheet-empty-line">Asocia moldes al producto para mostrarlos aquí.</p>}</section>
    </div> : <>
      <section className="sheet-section"><h3>Dibujos técnicos</h3><div className="technical-drawings">{(['front', 'back'] as const).map((side) => <label className="technical-drawing" key={side}><span>{side === 'front' ? 'Vista delantera' : 'Vista trasera'}</span>{sheet.content.drawings?.[side] ? <img src={sheet.content.drawings[side]!} alt={side === 'front' ? 'Dibujo técnico delantero' : 'Dibujo técnico trasero'} /> : <div className="drawing-placeholder">{side === 'front' ? 'FRONTAL' : 'TRASERA'}</div>}<input className="screen-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => updateImage(side, e)} /></label>)}</div></section>
      <section className="sheet-section"><h3>Tabla de medidas terminadas · cm</h3>{sheet.content.measurements?.length && sheet.content.sizes?.length ? <div className="product-table-wrap"><table className="sheet-table"><thead><tr><th>Punto de medición</th>{sheet.content.sizes.map((size) => <th key={size.id}>{size.name}</th>)}<th>Tolerancia</th></tr></thead><tbody>{sheet.content.measurements.map((measure) => <tr key={measure.id}><td><strong>{measure.name}</strong><small>{measure.description}</small></td>{sheet.content.sizes!.map((size) => <td key={size.id}><input className="sheet-measure-input screen-only" type="number" step="0.1" min="0" value={sheet.content.values?.[measure.id]?.[size.id] ?? ''} onChange={(e) => editMeasurement(measure.id, size.id, e.target.value)} /><span className="print-measure">{sheet.content.values?.[measure.id]?.[size.id] ?? '—'}</span></td>)}<td>± {measure.tolerance_cm ?? '—'}</td></tr>)}</tbody></table></div> : <p className="sheet-empty-line">Agrega tallas y medidas al producto para completar esta tabla.</p>}</section>
    </>}
    <section className={`sheet-section ${kind==='construction'?'designer-screen-only':''}`}><h3>Observaciones del taller</h3><textarea className="sheet-notes screen-only" rows={3} value={sheet.content.observations ?? ''} onChange={(e) => updateContent({ observations: e.target.value })} placeholder="Escribe instrucciones o notas para esta ficha" /><p className="print-notes">{sheet.content.observations || 'Sin observaciones.'}</p></section>
    <footer className={`sheet-paper-footer ${kind==='construction'?'designer-screen-only':''}`}><span>{product?.code} · Patronaje Pro</span><span>Documento de trabajo · Verificar datos antes de producción</span><span>v{sheet.version}</span></footer>
  </article>
}
