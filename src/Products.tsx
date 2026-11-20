import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowUpRight, Box, Clock3, Copy, Edit3, Plus, Scissors, Shirt, Trash2 } from 'lucide-react'
import './management.css'

type Product = { id: number; code: string; name: string; category: string; description: string; reference_image?: string | null; status: string; notes: string; updated_at: string; pattern_count?: number; size_count?: number }
type ProductDetail = Product & { reference_image: string | null; patterns: { id: number; name: string; updated_at: string }[]; sizes: { id: number; name: string }[]; materials: { id: number; name: string; kind: string; quantity: number | null; quantity_kind: string; unit: string }[]; sheet_count: number }
type Pattern = { id: number; name: string; updated_at: string }
type ProductDraft = Pick<Product, 'code' | 'name' | 'category' | 'description' | 'reference_image' | 'status' | 'notes'>

const blank: ProductDraft = { code: '', name: '', category: '', description: '', reference_image: null, status: 'draft', notes: '' }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.detail || 'No se pudo completar la operación') }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export function ProductsPage({ onManageSizes, onManageMaterials, onOpenEditor }: { onManageSizes: () => void; onManageMaterials: () => void; onOpenEditor: () => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState<number | null>(null)
  const [form, setForm] = useState<ProductDraft | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const editProduct = async (id: number) => {
    try {
      const product = await request<ProductDetail>(`/api/products/${id}`)
      setEditingId(id); setForm({ code: product.code, name: product.name, category: product.category || '', description: product.description, reference_image: product.reference_image, status: product.status, notes: product.notes })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo abrir el producto') }
  }

  const setImageFile = (file: File | undefined) => {
    if (!file || !form) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4_000_000) { setError('Elige una imagen PNG, JPG o WebP de hasta 4 MB'); return }
    const reader = new FileReader()
    reader.onload = () => setForm((current) => current ? { ...current, reference_image: String(reader.result) } : current)
    reader.onerror = () => setError('No se pudo leer la imagen')
    reader.readAsDataURL(file)
  }

  const refresh = async () => {
    setLoading(true)
    try { setProducts(await request<Product[]>('/api/products')); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Error al cargar productos') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  if (productId !== null) return <ProductDetailPage id={productId} onBack={() => { setProductId(null); void refresh() }} onEdit={(product) => { setEditingId(product.id); setForm(product) }} onManageSizes={onManageSizes} onManageMaterials={onManageMaterials} onOpenEditor={onOpenEditor} />

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault(); if (!form) return
    try {
      const saved = await request<Product>(editingId ? `/api/products/${editingId}` : '/api/products', { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      setForm(null); setEditingId(null); setProducts((list) => editingId ? list.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [saved, ...list]); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar') }
  }
  const duplicate = async (id: number) => {
    try { const copy = await request<Product>(`/api/products/${id}/duplicate`, { method: 'POST' }); setProducts((list) => [copy, ...list]) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo duplicar') }
  }
  const remove = async (product: Product) => {
    if (!window.confirm(`¿Eliminar el producto ${product.code} · ${product.name}? Los moldes se conservarán como borradores.`)) return
    try { await request(`/api/products/${product.id}`, { method: 'DELETE' }); setProducts((list) => list.filter((item) => item.id !== product.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo eliminar') }
  }

  const visible = products.filter((product) => `${product.name} ${product.code} ${product.category}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
  return <div className="management-page">
    <div className="management-heading"><div><div className="module-breadcrumb">ESPACIO DE TRABAJO <span>/</span> PRODUCTOS</div><h1>Productos</h1><p>Organiza cada modelo y mantén su trabajo de taller conectado.</p></div><button className="primary-button" onClick={() => { setEditingId(null); setForm(blank) }}><Plus size={16} /> Nuevo producto</button></div>
    <div className="management-toolbar"><div className="filter-field"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar por nombre, código o categoría" aria-label="Filtrar productos" /></div><span>{products.length} modelo{products.length === 1 ? '' : 's'}</span></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {loading ? <div className="management-empty">Cargando productos…</div> : visible.length ? <div className="product-table-wrap"><table className="data-table"><thead><tr><th>MODELO</th><th>CATEGORÍA</th><th>ESTADO</th><th>MOLDES</th><th>TALLAS</th><th>ACTUALIZADO</th><th /></tr></thead><tbody>{visible.map((product) => <tr key={product.id}><td><button className="model-cell" onClick={() => setProductId(product.id)}><span className="model-icon"><Shirt size={17} /></span><span><strong>{product.name}</strong><small>{product.code}</small></span></button></td><td>{product.category || '—'}</td><td><span className={`status-pill ${product.status}`}>{product.status === 'active' ? 'Activo' : product.status === 'archived' ? 'Archivado' : 'Borrador'}</span></td><td>{product.pattern_count ?? 0}</td><td>{product.size_count ?? 0}</td><td>{new Date(product.updated_at).toLocaleDateString('es-CL')}</td><td><div className="row-actions"><button title="Editar" onClick={() => void editProduct(product.id)}><Edit3 size={14} /></button><button title="Duplicar" onClick={() => duplicate(product.id)}><Copy size={14} /></button><button title="Eliminar" onClick={() => remove(product)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div> : <div className="management-empty"><span className="empty-product-icon"><Box size={22} /></span><strong>{filter ? 'No hay coincidencias' : 'Aún no tienes productos'}</strong><span>{filter ? 'Prueba con otro nombre, código o categoría.' : 'Crea un producto para reunir aquí sus moldes, tallas y materiales.'}</span>{!filter && <button onClick={() => setForm({ ...blank })}><Plus size={15} /> Crear primer producto</button>}</div>}
    {form && <div className="modal-backdrop"><form className="modal-card" onSubmit={saveProduct} role="dialog" aria-modal="true" aria-labelledby="product-form-title"><div className="modal-heading"><div><span className="modal-kicker">MODELO DE PRENDA</span><h2 id="product-form-title">{editingId ? 'Editar producto' : 'Nuevo producto'}</h2></div><button type="button" className="close-button" aria-label="Cerrar" onClick={() => { setForm(null); setEditingId(null) }}>×</button></div><div className="form-grid"><label>Código del modelo<input required maxLength={40} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Ej. PNT-001" /></label><label>Nombre<input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Pantalón recto" /></label><label>Categoría<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ej. Pantalones" /></label><label>Estado<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="draft">Borrador</option><option value="active">Activo</option><option value="archived">Archivado</option></select></label><label className="form-wide">Imagen de referencia (PNG, JPG o WebP · máximo 4 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setImageFile(e.target.files?.[0])} /></label>{form.reference_image && <div className="reference-image-preview form-wide"><img src={form.reference_image} alt="Vista previa de referencia" /><button type="button" className="secondary-button" onClick={() => setForm({ ...form, reference_image: null })}>Quitar imagen</button></div>}<label className="form-wide">Descripción<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} maxLength={2000} /></label><label className="form-wide">Observaciones<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={2000} /></label></div>{error && <div className="inline-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setForm(null); setEditingId(null) }}>Cancelar</button><button className="primary-button" type="submit">{editingId ? 'Guardar cambios' : 'Crear producto'}</button></div></form></div>}
  </div>
}

function ProductDetailPage({ id, onBack, onEdit, onManageSizes, onManageMaterials, onOpenEditor }: { id: number; onBack: () => void; onEdit: (product: ProductDraft & { id: number }) => void; onManageSizes: () => void; onManageMaterials: () => void; onOpenEditor: () => void }) {
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [history, setHistory] = useState<{ event: string; created_at: string }[]>([])
  const [patternId, setPatternId] = useState('')
  const [error, setError] = useState('')
  const refresh = async () => {
    try {
      const [detail, allPatterns, events] = await Promise.all([request<ProductDetail>(`/api/products/${id}`), request<Pattern[]>('/api/patterns'), request<{ event: string; created_at: string }[]>(`/api/products/${id}/history`)])
      setProduct(detail); setPatterns(allPatterns.filter((pattern) => !detail.patterns.some((linked) => linked.id === pattern.id))); setHistory(events)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar el producto') }
  }
  useEffect(() => { void refresh() }, [id])
  const attachPattern = async () => {
    if (!patternId) return
    try { await request(`/api/products/${id}/patterns/${patternId}`, { method: 'POST' }); setPatternId(''); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo asociar el molde') }
  }
  const detachPattern = async (pattern: Pattern) => {
    try { await request(`/api/products/${id}/patterns/${pattern.id}`, { method: 'DELETE' }); await refresh() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo desvincular el molde') }
  }
  if (!product) return <div className="management-page"><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Volver a productos</button><p>{error || 'Cargando producto…'}</p></div>
  return <div className="management-page"><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Productos</button><div className="detail-heading">{product.reference_image ? <img className="detail-reference-image" src={product.reference_image} alt={`Referencia de ${product.name}`} /> : <div className="detail-icon"><Shirt size={24} /></div>}<div><div className="module-breadcrumb">{product.category || 'SIN CATEGORÍA'} <span>/</span> {product.code}</div><h1>{product.name}</h1><p>{product.description || 'Sin descripción.'}</p></div><button className="secondary-button" onClick={() => onEdit(product)}><Edit3 size={14} /> Editar</button></div>
    {error && <div className="inline-error">{error}</div>}
    <div className="detail-columns"><section className="management-panel"><div className="panel-heading"><div><div className="panel-kicker">PATRONAJE</div><h2>Moldes asociados</h2></div><Scissors size={17} className="panel-icon-muted" /></div>{product.patterns.length ? product.patterns.map((pattern) => <div className="association-row" key={pattern.id}><span className="association-icon"><Scissors size={15} /></span><span><strong>{pattern.name}</strong><small>Guardado {new Date(pattern.updated_at).toLocaleDateString('es-CL')}</small></span><button title="Desvincular molde" onClick={() => detachPattern(pattern)}><Trash2 size={14} /></button></div>) : <div className="association-empty">Todavía no hay moldes vinculados.</div>}<div className="attach-row"><select aria-label="Elegir molde" value={patternId} onChange={(e) => setPatternId(e.target.value)}><option value="">Selecciona un borrador guardado</option>{patterns.map((pattern) => <option key={pattern.id} value={pattern.id}>{pattern.name}</option>)}</select><button className="secondary-button" disabled={!patternId} onClick={attachPattern}>Vincular</button></div><button className="link-button" onClick={onOpenEditor}>Abrir editor de moldes <ArrowUpRight size={14} /></button></section>
      <section className="management-panel"><div className="panel-heading"><div><div className="panel-kicker">PRODUCCIÓN</div><h2>Tallas y materiales</h2></div></div><div className="summary-line"><span>Tallas disponibles</span><strong>{product.sizes.length}</strong></div><div className="summary-line"><span>Materiales asociados</span><strong>{product.materials.length}</strong></div><div className="summary-line"><span>Fichas técnicas</span><strong>{product.sheet_count}</strong></div><div className="detail-actions"><button className="secondary-button" onClick={onManageSizes}>Gestionar tallas <ArrowUpRight size={14} /></button><button className="secondary-button" onClick={onManageMaterials}>Gestionar materiales <ArrowUpRight size={14} /></button></div></section>
    </div>
    <section className="management-panel history-panel"><div className="panel-heading"><div><div className="panel-kicker">TRAZABILIDAD</div><h2>Historial del producto</h2></div><Clock3 size={17} className="panel-icon-muted" /></div>{history.slice(0, 8).map((entry, index) => <div className="history-row" key={`${entry.created_at}-${index}`}><span className="history-dot" /><span>{historyLabel(entry.event)}</span><time>{new Date(entry.created_at).toLocaleString('es-CL')}</time></div>)}</section>
  </div>
}

function historyLabel(event: string) { return ({ created: 'Producto creado', updated: 'Datos del producto actualizados', duplicated: 'Producto duplicado', pattern_attached: 'Molde asociado', pattern_detached: 'Molde desvinculado', size_added: 'Talla añadida', size_removed: 'Talla retirada', measurement_added: 'Medida añadida', measurement_values_saved: 'Tabla de medidas actualizada', material_attached: 'Material asociado', material_detached: 'Material desvinculado', scaling_rule_saved: 'Regla de escalado guardada', consumption_estimated: 'Consumo estimado' } as Record<string, string>)[event] || event }
