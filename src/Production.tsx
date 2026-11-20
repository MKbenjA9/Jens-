import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowUpRight, Edit3, Plus, Ruler, Save, SwatchBook, Trash2 } from 'lucide-react'
import './management.css'

type ProductOption = { id: number; code: string; name: string }
type Size = { id: number; name: string; sort_order: number }
type Measurement = { id: number; name: string; description: string; tolerance_cm: number | null; sort_order: number }
type Rule = { id: number; measurement_id: number; from_size_id: number; to_size_id: number; increment_cm: number }
type ProductDetail = { id: number; code: string; name: string; sizes: Size[]; measurements: Measurement[]; measurement_values: { size_id: number; measurement_id: number; value_cm: number }[]; scaling_rules: Rule[] }
type Material = { id: number; name: string; kind: string; color: string; composition: string; width_mm: number | null; supplier: string; unit: string; unit_price: number | null; notes: string; quantity: number | null; quantity_kind: string; product_notes: string }
type MaterialDraft = { name: string; kind: string; color: string; composition: string; width: string; supplier: string; unit: string; unit_price: string; notes: string }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'No se pudo completar la operación') }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

export function SizesPage({ onProducts }: { onProducts: () => void }) {
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productId, setProductId] = useState('')
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [sizeName, setSizeName] = useState('')
  const [measureName, setMeasureName] = useState('')
  const [measureDescription, setMeasureDescription] = useState('')
  const [tolerance, setTolerance] = useState('')
  const [values, setValues] = useState<Record<number, Record<number, string>>>({})
  const [ruleMeasurement, setRuleMeasurement] = useState('')
  const [fromSize, setFromSize] = useState('')
  const [toSize, setToSize] = useState('')
  const [increment, setIncrement] = useState('')
  const [message, setMessage] = useState('')

  const refresh = async (id: string) => {
    if (!id) { setDetail(null); return }
    try {
      const data = await req<ProductDetail>(`/api/products/${id}`); setDetail(data)
      setValues(Object.fromEntries(data.measurements.map((measure) => [measure.id, Object.fromEntries(data.measurement_values.filter((value) => value.measurement_id === measure.id).map((value) => [value.size_id, value.value_cm.toString()]))])))
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo cargar el producto') }
  }
  useEffect(() => { void req<ProductOption[]>('/api/products').then((rows) => { setProducts(rows); if (rows[0]) setProductId(String(rows[0].id)) }).catch((error) => setMessage(error.message)) }, [])
  useEffect(() => { void refresh(productId) }, [productId])

  const addSize = async (event: FormEvent) => {
    event.preventDefault(); if (!productId || !sizeName.trim()) return
    try { await req(`/api/products/${productId}/sizes`, json({ name: sizeName.trim(), sort_order: detail?.sizes.length ?? 0 })); setSizeName(''); setMessage('Talla añadida'); await refresh(productId) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo añadir la talla') }
  }
  const removeSize = async (size: Size) => {
    if (!window.confirm(`¿Retirar la talla ${size.name}? También se borrarán sus valores de medida.`)) return
    try { await req(`/api/products/${productId}/sizes/${size.id}`, { method: 'DELETE' }); await refresh(productId); setMessage('Talla retirada') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo retirar la talla') }
  }
  const addMeasurement = async (event: FormEvent) => {
    event.preventDefault(); if (!productId || !measureName.trim()) return
    try { await req(`/api/products/${productId}/measurements`, json({ name: measureName.trim(), description: measureDescription, tolerance_cm: tolerance === '' ? null : Number(tolerance) })); setMeasureName(''); setMeasureDescription(''); setTolerance(''); setMessage('Punto de medida añadido'); await refresh(productId) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo añadir la medida') }
  }
  const saveValues = async () => {
    if (!detail) return
    try {
      await Promise.all(detail.measurements.map((measure) => req(`/api/products/${detail.id}/measurements/${measure.id}/values`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: Object.fromEntries(detail.sizes.map((size) => [size.id, values[measure.id]?.[size.id] === '' || values[measure.id]?.[size.id] === undefined ? null : Number(values[measure.id][size.id])])) }) })))
      setMessage('Tabla de medidas guardada'); await refresh(productId)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudieron guardar las medidas') }
  }
  const saveRule = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await req(`/api/products/${productId}/scaling-rules`, json({ measurement_id: Number(ruleMeasurement), from_size_id: Number(fromSize), to_size_id: Number(toSize), increment_cm: Number(increment) }))
      setMessage('Incremento guardado como regla de taller'); setIncrement(''); await refresh(productId)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar la regla') }
  }

  return <div className="management-page"><div className="management-heading"><div><div className="module-breadcrumb">ESPACIO DE TRABAJO <span>/</span> TALLAS Y MEDIDAS</div><h1>Tallas y medidas</h1><p>Registra medidas terminadas por talla y define incrementos propios del taller.</p></div></div>{message && <div className="inline-note">{message}</div>}
    {!products.length ? <div className="management-empty"><Ruler size={22} /><strong>Primero crea un producto</strong><span>Las tallas y medidas pertenecen a un modelo.</span><button onClick={onProducts}>Ir a productos <ArrowUpRight size={14} /></button></div> : <><label className="product-picker">Producto<select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((product) => <option value={product.id} key={product.id}>{product.code} · {product.name}</option>)}</select></label>{detail && <>
      <div className="production-grid"><section className="management-panel"><div className="panel-heading"><div><div className="panel-kicker">RANGO DE TALLAS</div><h2>Tallas disponibles</h2></div></div><div className="size-chip-list">{detail.sizes.map((size) => <span className="size-chip" key={size.id}>{size.name}<button title={`Retirar talla ${size.name}`} onClick={() => removeSize(size)}><Trash2 size={12} /></button></span>)}{!detail.sizes.length && <span className="muted-copy">Aún no hay tallas.</span>}</div><form className="compact-form" onSubmit={addSize}><input required value={sizeName} onChange={(e) => setSizeName(e.target.value)} placeholder="Ej. M" aria-label="Nueva talla" /><button className="secondary-button"><Plus size={14} /> Añadir talla</button></form></section>
        <section className="management-panel"><div className="panel-heading"><div><div className="panel-kicker">PUNTOS DE MEDICIÓN</div><h2>Medidas de la prenda</h2></div><Ruler size={17} className="panel-icon-muted" /></div><form className="measurement-form" onSubmit={addMeasurement}><input required value={measureName} onChange={(e) => setMeasureName(e.target.value)} placeholder="Ej. Contorno de cintura" aria-label="Nombre de la medida" /><input value={measureDescription} onChange={(e) => setMeasureDescription(e.target.value)} placeholder="Descripción del punto de medición" aria-label="Descripción de la medida" /><input type="number" min="0" step="0.1" value={tolerance} onChange={(e) => setTolerance(e.target.value)} placeholder="Tol. cm" aria-label="Tolerancia en centímetros" /><button className="secondary-button"><Plus size={14} /> Añadir</button></form></section></div>
      <section className="management-panel measurement-panel"><div className="panel-heading"><div><div className="panel-kicker">TABLA DE DETERMINACIÓN</div><h2>Medidas por talla</h2></div><button className="primary-button" disabled={!detail.sizes.length} onClick={saveValues}><Save size={15} /> Guardar medidas</button></div>{detail.sizes.length && detail.measurements.length ? <div className="product-table-wrap"><table className="data-table measurement-table"><thead><tr><th>MEDIDA · cm</th>{detail.sizes.map((size) => <th key={size.id}>{size.name}</th>)}<th>TOLERANCIA</th></tr></thead><tbody>{detail.measurements.map((measure) => <tr key={measure.id}><td><strong>{measure.name}</strong><small>{measure.description}</small></td>{detail.sizes.map((size) => <td key={size.id}><input type="number" min="0" step="0.1" aria-label={`${measure.name} talla ${size.name}`} value={values[measure.id]?.[size.id] ?? ''} onChange={(e) => setValues((current) => ({ ...current, [measure.id]: { ...current[measure.id], [size.id]: e.target.value } }))} /></td>)}<td>± {measure.tolerance_cm ?? '—'} cm</td></tr>)}</tbody></table></div> : <div className="table-empty">Agrega tallas y puntos de medición para crear la tabla.</div>}</section>
      {detail.sizes.length > 1 && detail.measurements.length > 0 && <section className="management-panel scaling-panel"><div className="panel-heading"><div><div className="panel-kicker">REGLAS DEL TALLER</div><h2>Incrementos entre tallas</h2></div></div><form className="scaling-form" onSubmit={saveRule}><select required value={ruleMeasurement} onChange={(e) => setRuleMeasurement(e.target.value)}><option value="">Medida</option>{detail.measurements.map((measure) => <option key={measure.id} value={measure.id}>{measure.name}</option>)}</select><select required value={fromSize} onChange={(e) => setFromSize(e.target.value)}><option value="">Desde talla</option>{detail.sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</select><select required value={toSize} onChange={(e) => setToSize(e.target.value)}><option value="">Hacia talla</option>{detail.sizes.map((size) => <option key={size.id} value={size.id}>{size.name}</option>)}</select><label><input required type="number" step="0.1" value={increment} onChange={(e) => setIncrement(e.target.value)} placeholder="0.0" /> cm</label><button className="secondary-button"><Plus size={14} /> Guardar regla</button></form>{detail.scaling_rules.map((rule) => <div className="rule-row" key={rule.id}><span>{detail.measurements.find((item) => item.id === rule.measurement_id)?.name}</span><strong>{detail.sizes.find((item) => item.id === rule.from_size_id)?.name} → {detail.sizes.find((item) => item.id === rule.to_size_id)?.name}</strong><span>{rule.increment_cm > 0 ? '+' : ''}{rule.increment_cm} cm</span></div>)}<p className="honesty-note"><AlertTriangle size={14} /> Estas reglas quedan registradas para el taller; el escalado geométrico de moldes se implementará después.</p></section>}
    </>}</>}
  </div>
}

const emptyMaterial: MaterialDraft = { name: '', kind: 'Tela', color: '', composition: '', width: '', supplier: '', unit: 'm', unit_price: '', notes: '' }

export function MaterialsPage({ onProducts }: { onProducts: () => void }) {
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productId, setProductId] = useState('')
  const [catalog, setCatalog] = useState<Material[]>([])
  const [linked, setLinked] = useState<Record<number, Material>>({})
  const [quantities, setQuantities] = useState<Record<number, string>>({})
  const [kinds, setKinds] = useState<Record<number, string>>({})
  const [draft, setDraft] = useState<MaterialDraft | null>(null)
  const [editingMaterialId, setEditingMaterialId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [wastage, setWastage] = useState('10')

  const loadCatalog = async () => { const rows = await req<Material[]>('/api/materials'); setCatalog(rows) }
  const loadProduct = async (id: string) => {
    if (!id) { setLinked({}); return }
    try {
      const detail = await req<{ materials: Material[] }>(`/api/products/${id}`)
      setLinked(Object.fromEntries(detail.materials.map((material) => [material.id, material])))
      setQuantities((current) => Object.fromEntries(detail.materials.map((material) => [material.id, material.quantity?.toString() ?? current[material.id] ?? ''])))
      setKinds(() => Object.fromEntries(detail.materials.map((material) => [material.id, material.quantity_kind])))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar el producto') }
  }
  useEffect(() => {
    Promise.all([req<ProductOption[]>('/api/products'), loadCatalog()]).then(([rows]) => { setProducts(rows); if (rows[0]) setProductId(String(rows[0].id)) }).catch((reason) => setError(reason.message))
  }, [])
  useEffect(() => { void loadProduct(productId) }, [productId])

  const saveMaterial = async (event: FormEvent) => {
    event.preventDefault(); if (!draft) return
    try {
      const body = { name: draft.name, kind: draft.kind, color: draft.color, composition: draft.composition, width_mm: draft.width ? Math.round(Number(draft.width) * 10) : null, supplier: draft.supplier, unit: draft.unit, unit_price: draft.unit_price ? Number(draft.unit_price) : null, notes: draft.notes }
      await req(editingMaterialId ? `/api/materials/${editingMaterialId}` : '/api/materials', { ...json(body), method: editingMaterialId ? 'PUT' : 'POST' })
      setDraft(null); setEditingMaterialId(null); await loadCatalog(); setNotice(editingMaterialId ? 'Material actualizado' : 'Material agregado al catálogo')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar el material') }
  }
  const saveLink = async (material: Material, quantityKind = kinds[material.id] || 'manual', quantity = quantities[material.id] === '' ? null : Number(quantities[material.id])) => {
    if (!productId) return
    try {
      await req(`/api/products/${productId}/materials`, json({ material_id: material.id, quantity, quantity_kind: quantityKind }))
      await loadProduct(productId); setNotice(quantityKind === 'estimated' ? 'Estimación guardada. Es un mínimo teórico, no un tizado.' : 'Consumo manual guardado'); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo asociar el material') }
  }
  const estimate = async (material: Material) => {
    if (!productId) return
    try {
      const result = await req<{ quantity: number; basis: string }>(`/api/products/${productId}/materials/${material.id}/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wastage_percent: Number(wastage) }) })
      setQuantities((current) => ({ ...current, [material.id]: String(result.quantity) })); await saveLink(material, 'estimated', result.quantity); setNotice(`${result.quantity} m estimados. ${result.basis}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo estimar el consumo') }
  }
  const detach = async (material: Material) => {
    try { await req(`/api/products/${productId}/materials/${material.id}`, { method: 'DELETE' }); await loadProduct(productId); setNotice('Material desvinculado del producto') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo desvincular') }
  }
  const removeCatalogMaterial = async (material: Material) => {
    if (!window.confirm(`¿Eliminar “${material.name}” del catálogo?`)) return
    try { await req(`/api/materials/${material.id}`, { method: 'DELETE' }); await loadCatalog(); setNotice('Material eliminado del catálogo') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo eliminar el material') }
  }
  const editMaterial = (material: Material) => {
    setEditingMaterialId(material.id)
    setDraft({ name: material.name, kind: material.kind, color: material.color, composition: material.composition, width: material.width_mm ? String(material.width_mm / 10) : '', supplier: material.supplier, unit: material.unit, unit_price: material.unit_price == null ? '' : String(material.unit_price), notes: material.notes || '' })
  }
  const associatedCount = Object.keys(linked).length

  return <div className="management-page"><div className="management-heading"><div><div className="module-breadcrumb">ESPACIO DE TRABAJO <span>/</span> MATERIALES</div><h1>Materiales</h1><p>Administra telas e insumos y registra su consumo por producto.</p></div><button className="primary-button" onClick={() => { setError(''); setEditingMaterialId(null); setDraft({ ...emptyMaterial }) }}><Plus size={16} /> Nuevo material</button></div>
    {notice && <div className="inline-note">{notice}</div>}{error && <div className="inline-error" role="alert">{error}</div>}
    {!products.length ? <div className="management-empty"><SwatchBook size={22} /><strong>Primero crea un producto</strong><span>El catálogo se puede preparar ahora y asociar después.</span><button onClick={() => { setEditingMaterialId(null); setDraft({ ...emptyMaterial }) }}>Crear material</button><button onClick={onProducts}>Ir a productos <ArrowUpRight size={14} /></button></div> : <label className="product-picker">Registrar consumo para<select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((product) => <option value={product.id} key={product.id}>{product.code} · {product.name}</option>)}</select><span>{associatedCount} material{associatedCount === 1 ? '' : 'es'} asociado{associatedCount === 1 ? '' : 's'}</span></label>}
    <section className="management-panel materials-panel"><div className="panel-heading"><div><div className="panel-kicker">CATÁLOGO COMPARTIDO</div><h2>Telas e insumos</h2></div><SwatchBook size={17} className="panel-icon-muted" /></div>{catalog.length ? <div className="product-table-wrap"><table className="data-table materials-table"><thead><tr><th>MATERIAL</th><th>COLOR / COMPOSICIÓN</th><th>ANCHO</th><th>PROVEEDOR</th><th>CONSUMO</th><th /></tr></thead><tbody>{catalog.map((material) => { const isLinked = Boolean(linked[material.id]); return <tr key={material.id}><td><strong>{material.name}</strong><small>{material.kind} · {material.unit}{material.unit_price != null ? ` · $${material.unit_price}` : ''}</small></td><td>{material.color || '—'}<small>{material.composition || ''}</small></td><td>{material.width_mm ? `${(material.width_mm / 10).toFixed(1)} cm` : '—'}</td><td>{material.supplier || '—'}</td><td>{productId ? <div className="consumption-cell"><input type="number" min="0" step="0.01" value={quantities[material.id] ?? ''} onChange={(e) => setQuantities((current) => ({ ...current, [material.id]: e.target.value }))} placeholder="Cantidad" aria-label={`Consumo de ${material.name}`} /><select value={kinds[material.id] || 'manual'} onChange={(e) => setKinds((current) => ({ ...current, [material.id]: e.target.value }))} aria-label={`Tipo de cantidad para ${material.name}`}><option value="manual">Manual</option><option value="estimated">Estimado</option></select></div> : '—'}</td><td><div className="row-actions">{productId && <>{isLinked ? <button title="Guardar consumo" onClick={() => saveLink(material)}><Save size={14} /></button> : <button title="Asociar al producto" onClick={() => saveLink(material)}><Plus size={15} /></button>}{material.kind.toLowerCase().includes('tela') && <button title="Estimar por área geométrica" onClick={() => estimate(material)}><Ruler size={14} /></button>}{isLinked && <button title="Desvincular del producto" onClick={() => detach(material)}><Trash2 size={14} /></button>}</>}<button title={`Editar ${material.name}`} onClick={() => editMaterial(material)}><Edit3 size={14} /></button><button title="Eliminar del catálogo" onClick={() => removeCatalogMaterial(material)}><Trash2 size={14} /></button></div></td></tr>})}</tbody></table></div> : <div className="table-empty">No hay materiales en el catálogo todavía.</div>}{catalog.length > 0 && productId && <div className="wastage-control"><label>Desperdicio para estimación (%)<input type="number" min="0" max="100" step="1" value={wastage} onChange={(e) => setWastage(e.target.value)} /></label><span><AlertTriangle size={14} /> El cálculo usa área de piezas cerradas ÷ ancho; no simula el tizado.</span></div>}</section>
    {draft && <div className="modal-backdrop"><form className="modal-card" onSubmit={saveMaterial} role="dialog" aria-modal="true" aria-labelledby="material-form-title"><div className="modal-heading"><div><span className="modal-kicker">CATÁLOGO DEL TALLER</span><h2 id="material-form-title">{editingMaterialId ? 'Editar material' : 'Nuevo material'}</h2></div><button type="button" className="close-button" aria-label="Cerrar" onClick={() => { setDraft(null); setEditingMaterialId(null) }}>×</button></div><div className="form-grid"><label>Nombre<input required maxLength={100} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej. Denim algodón" /></label><label>Tipo<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}><option>Tela</option><option>Hilo</option><option>Cierre</option><option>Botón</option><option>Elástico</option><option>Forro</option><option>Etiqueta</option><option>Otro insumo</option></select></label><label>Color<input value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label><label>Composición<input value={draft.composition} onChange={(e) => setDraft({ ...draft, composition: e.target.value })} placeholder="Ej. 98% algodón, 2% elastano" /></label><label>Ancho de tela (cm)<input type="number" min="0.1" step="0.1" value={draft.width} onChange={(e) => setDraft({ ...draft, width: e.target.value })} /></label><label>Proveedor<input value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} /></label><label>Unidad<select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}><option value="m">Metro (m)</option><option value="unidad">Unidad</option><option value="cono">Cono</option><option value="rollo">Rollo</option><option value="par">Par</option></select></label><label>Precio unitario (opcional)<input type="number" min="0" step="0.01" value={draft.unit_price} onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })} /></label><label className="form-wide">Observaciones<textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setDraft(null); setEditingMaterialId(null) }}>Cancelar</button><button className="primary-button">{editingMaterialId ? 'Guardar cambios' : 'Guardar material'}</button></div></form></div>}
  </div>
}
