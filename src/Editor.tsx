import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import {
  ArrowLeft, ChevronDown, Circle, Copy, CornerDownLeft, Crop, Download, History,
  Bookmark, Eraser, Hand, Image as ImageIcon, Minus, MousePointer2, Redo2, RotateCw, Save, Scissors, Spline, Trash2,
  Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import './editor.css'
import './photo.css'

type XY = { x: number; y: number }
type PointItem = XY & { id: string; type: 'point' }
type LineItem = XY & { id: string; type: 'line'; x2: number; y2: number; markType?: 'dart' | 'notch' | 'fold' | 'internal'; label?: string }
type CurveItem = XY & { id: string; type: 'curve'; cx: number; cy: number; x2: number; y2: number }
type PieceItem = { id: string; type: 'piece'; vertices: XY[]; label?: string; seamAllowanceMm?: number }
type Entity = PointItem | LineItem | CurveItem | PieceItem
type ReferenceImage = { id: string; name: string; data: string; original_data?: string; processed_data?: string; width: number; height: number; x: number; y: number; scale: number; opacity: number; calibrated: boolean; rotation?: number; locked?: boolean; flipX?: boolean; flipY?: boolean }
type Digitization = { code: string; created_at: string; method: string; source: string; review_required: boolean }
type Geometry = { items: Entity[]; reference_images?: ReferenceImage[]; photo_derived?: boolean; photo_scale_calibrated?: boolean; digitization?: Digitization }
type PatternSummary = { id: number; name: string; updated_at: string; product_id?: number | null }
type ProductOption = { id: number; code: string; name: string }
type TraceCandidate = { kind: 'piece' | 'line' | 'curve' | 'point'; role?: 'outline'|'interior'|'external'; points: number[][]; area_px?: number; length_px?: number }
type PatternVersion = { version: number; name: string; created_at: string }
type Tool = 'select' | 'point' | 'line' | 'mark' | 'curve' | 'piece'
type Drag = { id: string; ids: string[]; start: XY; entity: Entity; vertex?: number | 'control' | 'start' | 'end'; originalItems: Entity[] }
type PhotoMode = 'move' | 'calibrate' | 'crop' | 'perspective' | null
const toolOptions: { tool: Tool; name: string; icon: typeof MousePointer2; tip: string }[] = [
  { tool: 'select', name: 'Seleccionar', icon: MousePointer2, tip: 'V' },
  { tool: 'point', name: 'Punto', icon: Circle, tip: 'P' },
  { tool: 'line', name: 'Línea', icon: Minus, tip: 'L' },
  { tool: 'mark', name: 'Marca', icon: Bookmark, tip: 'M' },
  { tool: 'curve', name: 'Curva', icon: Spline, tip: 'C' },
  { tool: 'piece', name: 'Contorno', icon: Scissors, tip: 'Enter' },
]

function makeId() { return crypto.randomUUID() }
function cm(mm: number) { return `${(mm / 10).toFixed(1)} cm` }
function roundGrid(value: number, enabled: boolean) { return enabled ? Math.round(value / 10) * 10 : value }
function distance(a: XY, b: XY) { return Math.hypot(b.x - a.x, b.y - a.y) }
function imagePixelAt(image: ReferenceImage, world: XY): XY {
  const w=image.width*image.scale,h=image.height*image.scale,cx=image.x+w/2,cy=image.y+h/2,a=-(image.rotation??0)*Math.PI/180,dx=world.x-cx,dy=world.y-cy
  let x=cx+dx*Math.cos(a)-dy*Math.sin(a),y=cy+dx*Math.sin(a)+dy*Math.cos(a)
  x=(x-image.x)/image.scale;y=(y-image.y)/image.scale
  return {x:image.flipX?image.width-x:x,y:image.flipY?image.height-y:y}
}
function imageWorldAt(image: ReferenceImage, pixel: XY): XY {
  const w=image.width*image.scale,h=image.height*image.scale,cx=image.x+w/2,cy=image.y+h/2
  const x=image.x+(image.flipX?image.width-pixel.x:pixel.x)*image.scale,y=image.y+(image.flipY?image.height-pixel.y:pixel.y)*image.scale,a=(image.rotation??0)*Math.PI/180,dx=x-cx,dy=y-cy
  return {x:cx+dx*Math.cos(a)-dy*Math.sin(a),y:cy+dx*Math.sin(a)+dy*Math.cos(a)}
}
function entityLength(entity: Entity) {
  if (entity.type === 'line') return distance(entity, { x: entity.x2, y: entity.y2 })
  if (entity.type === 'piece') return entity.vertices.reduce((sum, point, i) => sum + distance(point, entity.vertices[(i + 1) % entity.vertices.length]), 0)
  if (entity.type === 'curve') {
    let length = 0, last = { x: entity.x, y: entity.y }
    for (let step = 1; step <= 30; step++) {
      const t = step / 30, n = 1 - t
      const next = { x: n * n * entity.x + 2 * n * t * entity.cx + t * t * entity.x2, y: n * n * entity.y + 2 * n * t * entity.cy + t * t * entity.y2 }
      length += distance(last, next); last = next
    }
    return length
  }
  return 0
}

function imageElement(data: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => { const image = new window.Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = data })
}
function drawMappedTriangle(context: CanvasRenderingContext2D, image: HTMLImageElement, src: XY[], dst: XY[]) {
  const [s0,s1,s2] = src, [d0,d1,d2] = dst
  const den = s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y)
  if (Math.abs(den) < 1e-6) return
  const a = (d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/den
  const c = (d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/den
  const e = (d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/den
  const b = (d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/den
  const d = (d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/den
  const f = (d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/den
  context.save(); context.beginPath(); context.moveTo(d0.x,d0.y); context.lineTo(d1.x,d1.y); context.lineTo(d2.x,d2.y); context.closePath(); context.clip(); context.setTransform(a,b,c,d,e,f); context.drawImage(image,0,0); context.restore()
}
function offsetPolygon(vertices: XY[], amount: number) {
  const area = vertices.reduce((sum,p,i) => { const q=vertices[(i+1)%vertices.length]; return sum+p.x*q.y-q.x*p.y },0)
  return vertices.map((point,i) => {
    const prev=vertices[(i+vertices.length-1)%vertices.length], next=vertices[(i+1)%vertices.length]
    const n1={x:(point.y-prev.y)*(area>0?1:-1),y:(prev.x-point.x)*(area>0?1:-1)}, n2={x:(next.y-point.y)*(area>0?1:-1),y:(point.x-next.x)*(area>0?1:-1)}
    const l1=Math.hypot(n1.x,n1.y)||1,l2=Math.hypot(n2.x,n2.y)||1,u1={x:n1.x/l1,y:n1.y/l1},u2={x:n2.x/l2,y:n2.y/l2},normal={x:u1.x+u2.x,y:u1.y+u2.y},length=Math.hypot(normal.x,normal.y)||1,bisector={x:normal.x/length,y:normal.y/length},scale=amount/Math.max(.25,bisector.x*u2.x+bisector.y*u2.y)
    return {x:point.x+bisector.x*scale,y:point.y+bisector.y*scale}
  })
}

export default function Editor({ onExit, initialPatternId }: { onExit: () => void; initialPatternId?: number | null }) {
  const [items, setItems] = useState<Entity[]>([])
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [photoDerived, setPhotoDerived] = useState(false)
  const [photoScaleCalibrated, setPhotoScaleCalibrated] = useState(true)
  const [digitization, setDigitization] = useState<Digitization | undefined>()
  const [products, setProducts] = useState<ProductOption[]>([])
  const [productId, setProductId] = useState<number | null>(null)
  const [showPhotoPanel, setShowPhotoPanel] = useState(false)
  const [showReference, setShowReference] = useState(true)
  const [showProcessed, setShowProcessed] = useState(false)
  const [activeImageId, setActiveImageId] = useState<string | null>(null)
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const [photoMode, setPhotoMode] = useState<PhotoMode>(null)
  const [photoPoints, setPhotoPoints] = useState<XY[]>([])
  const [calibrationCm, setCalibrationCm] = useState('10')
  const [photoError, setPhotoError] = useState('')
  const [traceMethod, setTraceMethod] = useState<'hybrid'|'adaptive'|'global'|'edges'>('hybrid')
  const [traceThreshold, setTraceThreshold] = useState(155)
  const [traceSensitivity, setTraceSensitivity] = useState(2)
  const [traceMinArea, setTraceMinArea] = useState(1200)
  const [traceCandidates, setTraceCandidates] = useState<TraceCandidate[]>([])
  const [traceSelected, setTraceSelected] = useState<number[]>([])
  const [traceWarnings, setTraceWarnings] = useState<string[]>([])
  const [processingPhoto, setProcessingPhoto] = useState(false)
  const [markType, setMarkType] = useState<NonNullable<LineItem['markType']>>('notch')
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<string[]>([])
  const [patternId, setPatternId] = useState<number | null>(null)
  const [name, setName] = useState('Nuevo molde')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('Borrador nuevo')
  const [patterns, setPatterns] = useState<PatternSummary[]>([])
  const [showPatterns, setShowPatterns] = useState(false)
  const [versions, setVersions] = useState<PatternVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [zoom, setZoom] = useState(0.65)
  const [center, setCenter] = useState<XY>({ x: 0, y: 0 })
  const [snap, setSnap] = useState(true)
  const [gridVisible, setGridVisible] = useState(true)
  const [draft, setDraft] = useState<XY[]>([])
  const [preview, setPreview] = useState<XY | null>(null)
  const [viewport, setViewport] = useState({ width: 900, height: 600 })
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const photoDragRef = useRef<{ id: string; start: XY; x: number; y: number; mode?: 'move'|'resize'|'rotate'; startDistance?: number; startAngle?: number; center?: XY; scale?: number; rotation?: number } | null>(null)
  const panRef = useRef<{ start: XY; center: XY } | null>(null)
  const undoRef = useRef<Entity[][]>([])
  const redoRef = useRef<Entity[][]>([])

  useEffect(() => {
    fetch('/api/patterns').then((response) => response.ok ? response.json() as Promise<PatternSummary[]> : []).then(setPatterns).catch(() => setPatterns([]))
    fetch('/api/products').then((response) => response.ok ? response.json() as Promise<ProductOption[]> : []).then(setProducts).catch(() => setProducts([]))
  }, [])

  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const commit = useCallback((next: Entity[]) => {
    undoRef.current = [...undoRef.current.slice(-99), items.map((item) => structuredClone(item))]
    redoRef.current = []
    setItems(next); setSaved(false)
  }, [items])

  const undo = useCallback(() => {
    const previous = undoRef.current.pop()
    if (!previous) return
    redoRef.current.push(items.map((item) => structuredClone(item)))
    setItems(previous); setSaved(false)
  }, [items])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(items.map((item) => structuredClone(item)))
    setItems(next); setSaved(false)
  }, [items])

  const pointAt = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY
    const local = point.matrixTransform(svg.getScreenCTM()?.inverse())
    return { x: local.x, y: local.y }
  }

  const save = async () => {
    const cleanName = name.trim()
    if (!cleanName) { setMessage('Escribe un nombre para el molde'); return }
    setSaving(true); setMessage('Guardando…')
    try {
      const response = await fetch(patternId ? `/api/patterns/${patternId}` : '/api/patterns', {
        method: patternId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, product_id: productId, geometry: { unit: 'mm', items, reference_images: referenceImages, photo_derived: photoDerived, photo_scale_calibrated: photoScaleCalibrated, ...(digitization?{digitization}:{}) } }),
      })
      if (!response.ok) throw new Error((await response.json()).detail ?? 'No se pudo guardar el molde')
      const pattern = await response.json() as { id: number; name: string; updated_at: string }
      setPatternId(pattern.id); setName(pattern.name); setSaved(true); setMessage(photoDerived && !photoScaleCalibrated ? 'Guardado · la escala fotográfica requiere calibración' : photoDerived && !items.some(item=>item.type==='piece') ? 'Foto guardada · aún sin pieza vectorial cerrada' : 'Guardado en este equipo')
      setPatterns((list) => [pattern, ...list.filter((entry) => entry.id !== pattern.id)])
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Error al guardar') }
    finally { setSaving(false) }
  }

  const loadPattern = async (id: number) => {
    try {
      const response = await fetch(`/api/patterns/${id}`)
      if (!response.ok) throw new Error('No se pudo abrir el molde')
      const data = await response.json() as { id: number; name: string; geometry: Geometry; product_id: number | null }
      setPatternId(data.id); setName(data.name); setItems(data.geometry.items ?? []); setReferenceImages(data.geometry.reference_images ?? []); setDigitization(data.geometry.digitization); setPhotoDerived(data.geometry.photo_derived ?? Boolean(data.geometry.reference_images?.length)); setPhotoScaleCalibrated(data.geometry.photo_scale_calibrated ?? !(data.geometry.reference_images?.some(image=>!image.calibrated)??false)); setProductId(data.product_id ?? null); setActiveImageId(data.geometry.reference_images?.[0]?.id ?? null); setShowPhotoPanel(Boolean(data.geometry.reference_images?.length)); setShowReference(true); setShowProcessed(Boolean(data.geometry.reference_images?.some(image=>image.processed_data))); setSelected([]); setPhotoMode(null); setPhotoPoints([]); setSaved(true); setMessage('Molde guardado')
      undoRef.current = []; redoRef.current = []; setShowPatterns(false)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Error al abrir') }
  }

  useEffect(()=>{if(initialPatternId)void loadPattern(initialPatternId)},[initialPatternId])

  const duplicatePattern = async (id: number) => {
    const response = await fetch(`/api/patterns/${id}/duplicate`, { method: 'POST' })
    if (!response.ok) { setMessage('No se pudo duplicar el molde'); return }
    const copy = await response.json() as { id: number; name: string; geometry: Geometry; updated_at: string; product_id: number | null }
    setPatterns((list) => [copy, ...list])
    setPatternId(copy.id); setName(copy.name); setItems(copy.geometry.items); setReferenceImages(copy.geometry.reference_images??[]); setDigitization(copy.geometry.digitization); setPhotoDerived(copy.geometry.photo_derived??Boolean(copy.geometry.reference_images?.length)); setPhotoScaleCalibrated(copy.geometry.photo_scale_calibrated??!(copy.geometry.reference_images?.some(image=>!image.calibrated)??false)); setActiveImageId(copy.geometry.reference_images?.[0]?.id??null); setProductId(copy.product_id??null); setSelected([]); setPhotoMode(null); setPhotoPoints([]); setSaved(true); setMessage('Copia guardada')
  }

  const removePattern = async (id: number, patternName: string) => {
    if (!window.confirm(`¿Eliminar “${patternName}”? Esta acción no se puede deshacer.`)) return
    const response = await fetch(`/api/patterns/${id}`, { method: 'DELETE' })
    if (!response.ok) { setMessage('No se pudo eliminar el molde'); return }
    setPatterns((list) => list.filter((entry) => entry.id !== id))
    if (patternId === id) newPattern()
    setMessage('Molde eliminado')
  }

  const openVersions = async () => {
    if (!patternId) return
    const response = await fetch(`/api/patterns/${patternId}/versions`)
    if (!response.ok) { setMessage('No se pudo cargar el historial'); return }
    setVersions(await response.json() as PatternVersion[]); setShowVersions((open) => !open)
  }

  const restoreVersion = async (version: number) => {
    if (!patternId) return
    const response = await fetch(`/api/patterns/${patternId}/restore/${version}`, { method: 'POST' })
    if (!response.ok) { setMessage('No se pudo restaurar la versión'); return }
    const restored = await response.json() as { id: number; name: string; geometry: Geometry }
    setName(restored.name); setItems(restored.geometry.items); setReferenceImages(restored.geometry.reference_images??[]); setDigitization(restored.geometry.digitization); setPhotoDerived(restored.geometry.photo_derived??Boolean(restored.geometry.reference_images?.length)); setPhotoScaleCalibrated(restored.geometry.photo_scale_calibrated??!(restored.geometry.reference_images?.some(image=>!image.calibrated)??false)); setActiveImageId(restored.geometry.reference_images?.[0]?.id??null); setSelected([]); setPhotoMode(null); setPhotoPoints([]); setSaved(true); setMessage(`Versión ${version} restaurada`); setShowVersions(false)
    const historyResponse = await fetch(`/api/patterns/${patternId}/versions`)
    if (historyResponse.ok) setVersions(await historyResponse.json() as PatternVersion[])
    setPatterns((list) => list.map((entry) => entry.id === patternId ? { ...entry, name: restored.name } : entry))
  }

  const newPattern = () => {
    if (!saved && items.length && !window.confirm('Este borrador no está guardado. ¿Quieres empezar otro molde?')) return
    setPatternId(null); setName('Nuevo molde'); setItems([]); setReferenceImages([]); setDigitization(undefined); setPhotoDerived(false); setPhotoScaleCalibrated(true); setProductId(null); setActiveImageId(null); setSelected([]); setPhotoMode(null); setPhotoPoints([]); setDraft([]); setSaved(false); setMessage('Borrador nuevo')
    undoRef.current = []; redoRef.current = []
  }

  const deleteSelected = useCallback(() => {
    if (!selected.length) return
    commit(items.filter((item) => !selected.includes(item.id))); setSelected([])
  }, [selected, items, commit])

  const duplicateSelected = useCallback(() => {
    if (!selected.length) return
    const copies = items.filter((item) => selected.includes(item.id)).map((item) => moveEntity({ ...structuredClone(item), id: makeId() } as Entity, 25, 25))
    commit([...items, ...copies]); setSelected(copies.map((item) => item.id))
  }, [selected, items, commit])

  const rotateSelected = useCallback(() => {
    const selection = items.filter((item) => selected.includes(item.id))
    if (!selection.length) return
    const points = selection.flatMap(entityPoints), xs = points.map((point) => point.x), ys = points.map((point) => point.y)
    const pivot = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    commit(items.map((item) => selected.includes(item.id) ? rotateEntity(item, pivot) : item))
  }, [selected, items, commit])

  const finishPolygon = useCallback(() => {
    if (draft.length < 3) { setMessage('Un contorno necesita al menos 3 puntos'); return }
    const item: PieceItem = { id: makeId(), type: 'piece', vertices: draft }
    commit([...items, item]); setSelected([item.id]); setDraft([]); setPreview(null); setTool('select')
  }, [draft, items, commit])

  const activeImage = referenceImages.find(image => image.id === activeImageId) ?? referenceImages[0] ?? null
  const changeReference = (id: string, changes: Partial<ReferenceImage>) => {
    const normalized = changes.data && !('processed_data' in changes) ? {...changes,processed_data:undefined} : changes
    const next=referenceImages.map(image=>image.id===id?{...image,...normalized}:image)
    if(JSON.stringify(next).length>9_500_000){setPhotoError('Las fotografías superan el máximo seguro de 9,5 MB por molde.');return}
    setReferenceImages(next); if(next.length&&next.every(image=>image.calibrated))setPhotoScaleCalibrated(true);else if(next.some(image=>!image.calibrated))setPhotoScaleCalibrated(false); setSaved(false)
  }
  const processPhoto = async () => {
    if(!activeImage)return
    setProcessingPhoto(true);setPhotoError('');setTraceCandidates([]);setTraceSelected([]);setTraceWarnings([])
    try {
      const response=await fetch('/api/photos/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_data:activeImage.data,method:traceMethod,threshold:traceThreshold,sensitivity:traceSensitivity,min_area:traceMinArea})})
      const result=await response.json()
      if(!response.ok)throw new Error(result.detail||'No se pudo procesar la foto')
      setTraceCandidates(result.candidates as TraceCandidate[]);setTraceWarnings(result.warnings as string[]);setShowProcessed(true);changeReference(activeImage.id,{processed_data:result.processed_preview});setPhotoMode(null);setPhotoPoints([])
    }catch(reason){setPhotoError(reason instanceof Error?reason.message:'No se pudo procesar la foto')}
    finally{setProcessingPhoto(false)}
  }
  const addTraceCandidates = () => {
    if(!activeImage||!traceSelected.length)return
    const added:Entity[]=traceSelected.map(index=>{const candidate=traceCandidates[index],mapPoint=(point:number[]):XY=>imageWorldAt(activeImage,{x:point[0],y:point[1]}),points=candidate.points.map(mapPoint),id=makeId()
      if(candidate.kind==='piece')return{id,type:'piece',vertices:points,label:`Pieza detectada ${index+1}`,seamAllowanceMm:0} as PieceItem
      if(candidate.kind==='line')return{id,type:'line',...points[0],x2:points[1].x,y2:points[1].y,...(candidate.role==='interior'?{markType:'internal' as const}:{}),label:candidate.role==='outline'?'Contorno candidato':candidate.role==='interior'?'Línea interior candidata':'Línea exterior candidata'} as LineItem
      if(candidate.kind==='curve')return{id,type:'curve',x:points[0].x,y:points[0].y,cx:points[1].x,cy:points[1].y,x2:points[2].x,y2:points[2].y} as CurveItem
      return{id,type:'point',...points[0]} as PointItem
    })
    commit([...items,...added]);setSelected(added.map(item=>item.id));setMessage(`${added.length} candidato(s) añadido(s); revisa el trazado`);setTraceSelected([])
  }
  const importPhotos = async (files: FileList | null) => {
    if (!files?.length) return
    setPhotoError('')
    const candidates = Array.from(files)
    if (candidates.some(file => !['image/jpeg','image/png'].includes(file.type) || file.size > 2_500_000)) { setPhotoError('Usa fotos JPG o PNG de hasta 2,5 MB cada una.'); return }
    let loaded: ReferenceImage[]
    try { loaded = await Promise.all(candidates.map(file => new Promise<ReferenceImage>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = async () => { try { const data = String(reader.result); const image = await imageElement(data); resolve({ id: makeId(), name: file.name, data, original_data: data, width: image.naturalWidth, height: image.naturalHeight, x: -image.naturalWidth * 0.05, y: -image.naturalHeight * 0.05, scale: 0.1, opacity: 0.55, calibrated: false }) } catch { reject() } }; reader.onerror = () => reject(); reader.readAsDataURL(file)
    }))) } catch { setPhotoError('No se pudieron leer una o más fotografías.'); return }
    const next = [...referenceImages, ...loaded]
    if (JSON.stringify(next).length > 9_500_000) { setPhotoError('El conjunto de fotos supera el máximo seguro de 9,5 MB por molde.'); return }
    setReferenceImages(next); setPhotoDerived(true); setPhotoScaleCalibrated(false); setActiveImageId(loaded[0].id); setShowReference(true); setSaved(false); setShowPhotoPanel(true)
  }
  const rotatePhoto = async () => {
    if (!activeImage) return
    const image = await imageElement(activeImage.data), canvas = document.createElement('canvas'), context = canvas.getContext('2d')!
    canvas.width = image.naturalHeight; canvas.height = image.naturalWidth; context.translate(canvas.width / 2, canvas.height / 2); context.rotate(Math.PI / 2); context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
    const scale = activeImage.scale, centerWorld = { x: activeImage.x + activeImage.width * scale / 2, y: activeImage.y + activeImage.height * scale / 2 }
    changeReference(activeImage.id, { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, x: centerWorld.x - canvas.width * scale / 2, y: centerWorld.y - canvas.height * scale / 2, calibrated: false })
  }
  const applyCalibration = () => {
    if (!activeImage || photoPoints.length !== 2) return
    const px1 = imagePixelAt(activeImage,photoPoints[0])
    const px2 = imagePixelAt(activeImage,photoPoints[1])
    const realCm = Number(calibrationCm), pixelDistance = distance(px1, px2)
    if (!Number.isFinite(realCm) || realCm <= 0 || pixelDistance < 1) { setPhotoError('La distancia debe ser positiva y los puntos deben estar separados.'); return }
    const scale = realCm * 10 / pixelDistance
    const centerPoint={x:activeImage.x+activeImage.width*activeImage.scale/2,y:activeImage.y+activeImage.height*activeImage.scale/2}
    changeReference(activeImage.id, { x:centerPoint.x-activeImage.width*scale/2, y:centerPoint.y-activeImage.height*scale/2, scale, calibrated: true }); setPhotoMode(null); setPhotoPoints([]); setPhotoError('')
  }
  const cropPhoto = async (worldPoints: XY[]) => {
    if (!activeImage || worldPoints.length !== 2) return
    const px = worldPoints.map(point => imagePixelAt(activeImage,point))
    const left = Math.max(0, Math.floor(Math.min(px[0].x, px[1].x))), top = Math.max(0, Math.floor(Math.min(px[0].y, px[1].y))), right = Math.min(activeImage.width, Math.ceil(Math.max(px[0].x, px[1].x))), bottom = Math.min(activeImage.height, Math.ceil(Math.max(px[0].y, px[1].y)))
    if (right - left < 20 || bottom - top < 20) { setPhotoError('El recorte debe cubrir un área de al menos 20 × 20 px.'); return }
    const image = await imageElement(activeImage.data), canvas = document.createElement('canvas'); canvas.width = right - left; canvas.height = bottom - top; canvas.getContext('2d')!.drawImage(image, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    const nextX=activeImage.x+(activeImage.flipX?activeImage.width-right:left)*activeImage.scale,nextY=activeImage.y+(activeImage.flipY?activeImage.height-bottom:top)*activeImage.scale
    changeReference(activeImage.id, { data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, x: nextX, y: nextY, calibrated:false });setPhotoScaleCalibrated(false)
    setPhotoMode(null); setPhotoPoints([]); setPhotoError('')
  }
  const rectifyPhoto = async (corners: XY[]) => {
    if (!activeImage || corners.length !== 4) return
    const source = corners.map(point => imagePixelAt(activeImage,point))
    const topWidth = distance(source[0], source[1]), bottomWidth = distance(source[3], source[2]), leftHeight = distance(source[0], source[3]), rightHeight = distance(source[1], source[2])
    const width = Math.round((topWidth + bottomWidth) / 2), height = Math.round((leftHeight + rightHeight) / 2)
    const area=Math.abs(source.reduce((sum,p,i)=>{const q=source[(i+1)%4];return sum+p.x*q.y-q.x*p.y},0)/2)
    if (width < 30 || height < 30 || area < 900 || source.some(point=>point.x<0||point.y<0||point.x>activeImage.width||point.y>activeImage.height)) { setPhotoError('Selecciona los cuatro vértices del papel dentro de la foto y en orden, empezando arriba a la izquierda.'); return }
    const image = await imageElement(activeImage.data), canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')!, segments = 28
    const [p0,p1,p2,p3]=source, dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y,den=dx1*dy2-dx2*dy1
    if (Math.abs(den)<1e-6 && Math.abs(dx3)+Math.abs(dy3)>=1e-6) { setPhotoError('No se pudo corregir la perspectiva: revisa el orden de las cuatro esquinas.'); return }
    const g=Math.abs(dx3)+Math.abs(dy3)<1e-6?0:(dx3*dy2-dx2*dy3)/den,h=Math.abs(dx3)+Math.abs(dy3)<1e-6?0:(dx1*dy3-dx3*dy1)/den
    const sourceAt = (u: number, v: number): XY => { const divisor=g*u+h*v+1; return { x: ((p1.x-p0.x+g*p1.x)*u+(p3.x-p0.x+h*p3.x)*v+p0.x)/divisor, y: ((p1.y-p0.y+g*p1.y)*u+(p3.y-p0.y+h*p3.y)*v+p0.y)/divisor } }
    const destAt = (u: number, v: number): XY => ({ x: u*width, y: v*height })
    for (let row=0; row<segments; row++) for (let col=0; col<segments; col++) {
      const u0=col/segments,u1=(col+1)/segments,v0=row/segments,v1=(row+1)/segments,s00=sourceAt(u0,v0),s10=sourceAt(u1,v0),s11=sourceAt(u1,v1),s01=sourceAt(u0,v1),d00=destAt(u0,v0),d10=destAt(u1,v0),d11=destAt(u1,v1),d01=destAt(u0,v1)
      drawMappedTriangle(context,image,[s00,s10,s11],[d00,d10,d11]); drawMappedTriangle(context,image,[s00,s11,s01],[d00,d11,d01])
    }
    const anchor=imageWorldAt(activeImage,source[0])
    changeReference(activeImage.id, { data: canvas.toDataURL('image/png'), width, height, x: anchor.x, y: anchor.y, rotation:0, flipX:false, flipY:false, calibrated: false })
    setPhotoMode(null); setPhotoPoints([]); setPhotoError('La corrección de perspectiva cambia ligeramente la escala. Vuelve a calibrar la fotografía.')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected() }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
      else if (event.key === 'Enter' && tool === 'piece') finishPolygon()
      else if (event.key.toLowerCase() === 'v') setTool('select')
      else if (event.key.toLowerCase() === 'p') setTool('point')
      else if (event.key.toLowerCase() === 'l') setTool('line')
      else if (event.key.toLowerCase() === 'm') setTool('mark')
      else if (event.key.toLowerCase() === 'c') setTool('curve')
      else if (event.key === 'Escape') { setDraft([]); setPreview(null); setTool('select'); setSelected([]) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, duplicateSelected, deleteSelected, tool, finishPolygon])

  const onCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.button === 2) {
      event.preventDefault(); panRef.current = { start: { x: event.clientX, y: event.clientY }, center }; event.currentTarget.setPointerCapture(event.pointerId); return
    }
    if (photoMode && activeImage) {
      event.preventDefault(); event.stopPropagation()
      const point = pointAt(event)
      if (photoMode === 'move') { photoDragRef.current={id:activeImage.id,start:point,x:activeImage.x,y:activeImage.y}; event.currentTarget.setPointerCapture(event.pointerId); return }
      const next = [...photoPoints, point]
      setPhotoPoints(next)
      if (photoMode === 'crop' && next.length === 2) void cropPhoto(next)
      if (photoMode === 'perspective' && next.length === 4) void rectifyPhoto(next)
      return
    }
    if (tool === 'select') { setSelected([]); setSelectedImageId(null); return }
    const point = pointAt(event), snapped = { x: roundGrid(point.x, snap), y: roundGrid(point.y, snap) }
    if (tool === 'point') { const item: PointItem = { id: makeId(), type: 'point', ...snapped }; commit([...items, item]); setSelected([item.id]) }
    if (tool === 'line' || tool === 'mark') {
      if (!draft.length) { setDraft([snapped]); setPreview(snapped) }
      else { const item: LineItem = { id: makeId(), type: 'line', ...draft[0], x2: snapped.x, y2: snapped.y, ...(tool === 'mark' ? { markType } : {}) }; commit([...items, item]); setSelected([item.id]); setDraft([]); setPreview(null) }
    }
    if (tool === 'curve') {
      if (draft.length < 2) { const next = [...draft, snapped]; setDraft(next); setPreview(snapped) }
      else { const item: CurveItem = { id: makeId(), type: 'curve', ...draft[0], cx: draft[1].x, cy: draft[1].y, x2: snapped.x, y2: snapped.y }; commit([...items, item]); setSelected([item.id]); setDraft([]); setPreview(null) }
    }
    if (tool === 'piece') {
      if (draft.length > 2 && distance(snapped, draft[0]) < 18) { finishPolygon(); return }
      setDraft((vertices) => [...vertices, snapped]); setPreview(snapped)
    }
  }

  const onCanvasPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (photoDragRef.current) {
      const drag=photoDragRef.current,point=pointAt(event)
      setReferenceImages(current=>current.map(image=>{
        if(image.id!==drag.id)return image
        if(drag.mode==='rotate'&&drag.center)return {...image,rotation:(drag.rotation??0)+(Math.atan2(point.y-drag.center.y,point.x-drag.center.x)-(drag.startAngle??0))*180/Math.PI}
        if(drag.mode==='resize'&&drag.center){const factor=Math.max(.03,Math.hypot(point.x-drag.center.x,point.y-drag.center.y)/Math.max(1,drag.startDistance??1));return {...image,scale:(drag.scale??image.scale)*factor,calibrated:false}}
        return {...image,x:drag.x+point.x-drag.start.x,y:drag.y+point.y-drag.start.y}
      }))
      if(drag.mode==='resize')setPhotoScaleCalibrated(false)
      setSaved(false);return
    }
    if (panRef.current) {
      const factor = 1 / zoom
      setCenter({ x: panRef.current.center.x - (event.clientX - panRef.current.start.x) * factor, y: panRef.current.center.y - (event.clientY - panRef.current.start.y) * factor }); return
    }
    const point = pointAt(event)
    if (dragRef.current) {
      const drag = dragRef.current, dx = roundGrid(point.x - drag.start.x, snap), dy = roundGrid(point.y - drag.start.y, snap)
      setItems(drag.originalItems.map((item) => item.id === drag.id ? moveEntity(drag.entity, dx, dy, drag.vertex) : drag.ids.includes(item.id) ? moveEntity(item, dx, dy) : item))
    } else if (tool !== 'select') setPreview({ x: roundGrid(point.x, snap), y: roundGrid(point.y, snap) })
  }

  const onCanvasPointerUp = () => {
    photoDragRef.current = null
    panRef.current = null
    if (dragRef.current) {
      undoRef.current = [...undoRef.current.slice(-99), dragRef.current.originalItems]
      redoRef.current = []; dragRef.current = null; setSaved(false)
    }
  }

  const onReferencePointerDown = (event: PointerEvent<SVGElement>, image: ReferenceImage, mode: 'move'|'resize'|'rotate' = 'move') => {
    if(tool!=='select'||photoMode||event.button!==0||image.locked)return
    event.preventDefault();event.stopPropagation();setSelectedImageId(image.id);setActiveImageId(image.id);setSelected([])
    const point=pointAt(event),centerPoint={x:image.x+image.width*image.scale/2,y:image.y+image.height*image.scale/2}
    photoDragRef.current={id:image.id,start:point,x:image.x,y:image.y,mode,center:centerPoint,scale:image.scale,rotation:image.rotation??0,startDistance:Math.hypot(point.x-centerPoint.x,point.y-centerPoint.y),startAngle:Math.atan2(point.y-centerPoint.y,point.x-centerPoint.x)}
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
  }

  const onItemPointerDown = (event: PointerEvent<SVGElement>, item: Entity, vertex?: number | 'control' | 'start' | 'end') => {
    if (tool !== 'select' || event.button !== 0) return
    event.stopPropagation(); const point = pointAt(event)
    if (!event.shiftKey && !selected.includes(item.id)) setSelected([item.id])
    else if (event.shiftKey) setSelected((current) => current.includes(item.id) ? current : [...current, item.id])
    const movingIds = vertex === undefined ? (event.shiftKey ? [...new Set([...selected, item.id])] : selected.includes(item.id) ? selected : [item.id]) : [item.id]
    dragRef.current = { id: item.id, ids: movingIds, start: point, entity: structuredClone(item), vertex, originalItems: items.map((entry) => structuredClone(entry)) }
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
  }

  const onWheel = (event: WheelEvent<SVGSVGElement>) => { event.preventDefault(); setZoom((value) => Math.min(2.4, Math.max(0.2, value * (event.deltaY < 0 ? 1.1 : 0.9)))) }

  const visibleWidth = viewport.width / zoom, visibleHeight = viewport.height / zoom
  const viewX = center.x - visibleWidth / 2, viewY = center.y - visibleHeight / 2
  const selectedEntities = items.filter((item) => selected.includes(item.id))
  const selectedItem = selectedEntities.length === 1 ? selectedEntities[0] : null
  const updateItem = (id: string, changes: Partial<Entity>) => commit(items.map(item => item.id === id ? { ...item, ...changes } as Entity : item))
  const convertLineToCurve = (item: LineItem) => { const curve:CurveItem={id:item.id,type:'curve',x:item.x,y:item.y,cx:(item.x+item.x2)/2,cy:(item.y+item.y2)/2,x2:item.x2,y2:item.y2};commit(items.map(entity=>entity.id===item.id?curve:entity));setSelected([curve.id]) }
  const resizePiece = (item: PieceItem, axis: 'x'|'y', cmValue: number) => {
    if (!Number.isFinite(cmValue) || cmValue <= 0) return
    const values=item.vertices.map(point=>point[axis]), min=Math.min(...values), max=Math.max(...values), span=max-min
    if (span<=0) return
    const factor=cmValue*10/span
    updateItem(item.id,{vertices:item.vertices.map(point=>({...point,[axis]:min+(point[axis]-min)*factor}))})
  }

  return <div className="editor-shell">
    <div className="editor-head">
      <button className="editor-back" onClick={onExit} aria-label="Volver al inicio"><ArrowLeft size={17} /></button>
      <div className="editor-document"><Scissors size={16} /><input aria-label="Nombre del molde" value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} /><select className="editor-product-link" aria-label="Producto asociado" value={productId ?? ''} onChange={event => { setProductId(Number(event.target.value) || null); setSaved(false) }}><option value="">Sin producto</option>{products.map(product => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}</select><span className={`save-status ${saved ? 'is-saved' : ''}`}><i />{message}</span></div>
      <div className="editor-head-actions"><div className="patterns-menu-wrap"><button className="editor-quiet" onClick={() => setShowPatterns((value) => !value)}>Mis moldes <ChevronDown size={14} /></button>{showPatterns && <div className="patterns-menu"><button onClick={newPattern} className="patterns-new">+ Nuevo borrador</button>{patterns.length ? patterns.map((pattern) => <div className="pattern-row" key={pattern.id}><button className="pattern-open" onClick={() => loadPattern(pattern.id)}><span>{pattern.name}</span><small>{new Date(pattern.updated_at).toLocaleDateString('es-CL')}</small></button><button className="pattern-action" title={`Duplicar ${pattern.name}`} onClick={() => duplicatePattern(pattern.id)}><Copy size={13} /></button><button className="pattern-action pattern-delete" title={`Eliminar ${pattern.name}`} onClick={() => removePattern(pattern.id, pattern.name)}><Trash2 size={13} /></button></div>) : <div className="patterns-empty">Aún no hay moldes guardados.</div>}</div>}</div><button className="editor-save" onClick={save} disabled={saving}><Save size={15} />{saving ? 'Guardando' : 'Guardar molde'}</button></div>
    </div>
    <div className="editor-toolbar">
      <div className="tool-group">{toolOptions.map(({ tool: option, name: label, icon: Icon, tip }) => <button key={option} className={`tool-button ${tool === option ? 'active' : ''}`} onClick={() => { setTool(option); setDraft([]); setPreview(null); setPhotoMode(null); setPhotoPoints([]) }} title={`${label} (${tip})`} aria-pressed={tool === option}><Icon size={17} /><span>{label}</span></button>)}<button className={`tool-button ${showPhotoPanel ? 'active' : ''}`} onClick={() => setShowPhotoPanel(value => !value)} title="Fotografía de referencia"><ImageIcon size={16}/><span>Foto</span></button></div>
      <span className="toolbar-separator" />
      {tool === 'mark' && <select className="mark-kind-select" aria-label="Tipo de marca" value={markType} onChange={event => setMarkType(event.target.value as NonNullable<LineItem['markType']>)}><option value="notch">Piquete</option><option value="dart">Pinza</option><option value="fold">Doblez</option><option value="internal">Línea interna</option></select>}
      <div className="tool-group compact-tools"><button className="tool-button" onClick={undo} disabled={!undoRef.current.length} title="Deshacer (Ctrl+Z)"><Undo2 size={17} /></button><button className="tool-button" onClick={redo} disabled={!redoRef.current.length} title="Rehacer (Ctrl+Y)"><Redo2 size={17} /></button><button className="tool-button" onClick={duplicateSelected} disabled={!selected.length} title="Duplicar (Ctrl+D)"><Copy size={16} /></button><button className="tool-button" onClick={rotateSelected} disabled={!selected.length} title="Rotar 90°">↻</button><button className="tool-button danger" onClick={deleteSelected} disabled={!selected.length} title="Eliminar (Supr)"><Eraser size={17} /></button></div>
      <span className="toolbar-spacer" />
      <label className="toggle-control"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Ajustar</label><label className="toggle-control"><input type="checkbox" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)} /> Cuadrícula</label>
    </div>
    <div className="editor-workspace">
      <div className="editor-canvas-wrap">
        <div className="canvas-top-ruler"><span className="ruler-unit">cm</span>{Array.from({ length: Math.ceil(visibleWidth / 100) + 2 }, (_, index) => { const value = Math.floor(viewX / 100) * 100 + index * 100; return <span className="ruler-tick-x" style={{ left: (value - viewX) * zoom }} key={value}>{(value / 10).toFixed(0)}</span> })}</div>
        <div className="canvas-left-ruler">{Array.from({ length: Math.ceil(visibleHeight / 100) + 2 }, (_, index) => { const value = Math.floor(viewY / 100) * 100 + index * 100; return <span className="ruler-tick-y" style={{ top: (value - viewY) * zoom }} key={value}>{(value / 10).toFixed(0)}</span> })}</div>
        <div className="canvas-frame" ref={canvasRef}>
          {showPhotoPanel && <div className="photo-panel" onPointerDown={event => event.stopPropagation()}>
            <div className="photo-panel-head"><strong>Fotografía de referencia</strong><label><input type="checkbox" checked={showReference} onChange={event => setShowReference(event.target.checked)}/> Mostrar</label></div>
            <label className="photo-upload"><ImageIcon size={15}/> Importar fotos JPG/PNG<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple onChange={event => { void importPhotos(event.target.files); event.currentTarget.value = '' }}/></label>
            {referenceImages.length > 0 && <><label>Imagen activa<select value={activeImage?.id ?? ''} onChange={event => { const next=referenceImages.find(image=>image.id===event.target.value); setActiveImageId(event.target.value); setPhotoPoints([]); setPhotoMode(null); setShowProcessed(Boolean(next?.processed_data)) }}>{referenceImages.map(image => <option key={image.id} value={image.id}>{image.name}{image.calibrated ? ' · calibrada' : ' · sin calibrar'}</option>)}</select></label>
              {activeImage!.original_data && <details className="photo-original"><summary>Ver foto original conservada</summary><img src={activeImage!.original_data} alt="Fotografía original"/></details>}
              <div className="photo-actions"><button className={photoMode === 'move' ? 'active' : ''} onClick={() => { setPhotoMode(photoMode === 'move' ? null : 'move'); setPhotoPoints([]) }}><Hand size={13}/> Mover / unir</button><button onClick={rotatePhoto}><RotateCw size={13}/> Girar 90°</button></div>
              <button className={`photo-mode-button ${photoMode === 'crop' ? 'active' : ''}`} onClick={() => { setPhotoMode(photoMode === 'crop' ? null : 'crop'); setPhotoPoints([]) }}><Crop size={13}/> Recortar · marca 2 esquinas</button>
              <button className={`photo-mode-button ${photoMode === 'perspective' ? 'active' : ''}`} onClick={() => { setPhotoMode(photoMode === 'perspective' ? null : 'perspective'); setPhotoPoints([]) }}>Corregir perspectiva · marca 4 esquinas</button>
              <button className={`photo-mode-button ${photoMode === 'calibrate' ? 'active' : ''}`} onClick={() => { setPhotoMode(photoMode === 'calibrate' ? null : 'calibrate'); setPhotoPoints([]) }}>Calibrar escala · marca 2 puntos</button>
              {photoMode === 'calibrate' && <div className="calibration-entry"><label>Distancia real (cm)<input type="number" min="0.1" step="0.1" value={calibrationCm} onChange={event => setCalibrationCm(event.target.value)}/></label><button disabled={photoPoints.length !== 2} onClick={applyCalibration}>Aplicar calibración</button></div>}
              <section className="photo-trace"><strong>Extracción vectorial (candidatos)</strong><label>Método<select value={traceMethod} onChange={event=>setTraceMethod(event.target.value as typeof traceMethod)}><option value="hybrid">Híbrido · iluminación + líneas</option><option value="adaptive">Adaptativo · corrige sombras</option><option value="global">Umbral global</option><option value="edges">Detección de bordes</option></select></label>{traceMethod==='global'&&<label>Umbral<input type="range" min="30" max="240" value={traceThreshold} onChange={event=>setTraceThreshold(Number(event.target.value))}/></label>}<label>Sensibilidad<input type="range" min="1" max="3" value={traceSensitivity} onChange={event=>setTraceSensitivity(Number(event.target.value))}/></label><label>Área mínima (px²)<input type="number" min="100" max="100000" step="100" value={traceMinArea} onChange={event=>setTraceMinArea(Number(event.target.value))}/></label><button className="photo-mode-button" disabled={processingPhoto} onClick={processPhoto}>{processingPhoto?'Procesando…':'Procesar y detectar vectores'}</button>
                {activeImage!.processed_data&&<label className="photo-panel-head"><span>Capa procesada</span><input type="checkbox" checked={showProcessed} onChange={event=>setShowProcessed(event.target.checked)}/></label>}
                {traceWarnings.map(warning=><small className="photo-warning" key={warning}>{warning}</small>)}
                {traceCandidates.length>0&&<><small className="photo-help">{traceCandidates.length} candidatos · revísalos y selecciona lo que quieras conservar.</small><div className="trace-candidate-list">{traceCandidates.map((candidate,index)=><label key={index}><input type="checkbox" checked={traceSelected.includes(index)} onChange={event=>setTraceSelected(current=>event.target.checked?[...current,index]:current.filter(item=>item!==index))}/><span>{candidate.kind==='piece'?'Contorno cerrado':candidate.kind==='curve'?'Tramo curvo candidato':candidate.kind==='line'?`${candidate.role==='outline'?'Contorno':candidate.role==='interior'?'Línea interior':'Línea exterior'} candidata`:'Punto/esquina'} {index+1}</span><small>{candidate.kind==='piece'?`${candidate.points.length} vértices`:candidate.kind==='line'||candidate.kind==='curve'?`${candidate.length_px??0} px`:''}</small></label>)}</div><div className="photo-actions"><button onClick={()=>setTraceSelected(traceCandidates.map((_,index)=>index))}>Seleccionar todo</button><button disabled={!traceSelected.length} onClick={addTraceCandidates}>Añadir seleccionados</button></div></>}
              </section>
              <div className="photo-coordinates"><label>X (cm)<input type="number" step="0.1" value={(activeImage!.x/10).toFixed(1)} onChange={event => changeReference(activeImage!.id,{x:Number(event.target.value)*10})}/></label><label>Y (cm)<input type="number" step="0.1" value={(activeImage!.y/10).toFixed(1)} onChange={event => changeReference(activeImage!.id,{y:Number(event.target.value)*10})}/></label></div>
              <label className="photo-panel-field">Ancho (cm)<input type="number" min="0.1" step="0.1" value={(activeImage!.width*activeImage!.scale/10).toFixed(1)} onChange={event=>{const width=Number(event.target.value)*10;if(width>0){changeReference(activeImage!.id,{scale:width/activeImage!.width,calibrated:false});setPhotoScaleCalibrated(false)}}}/></label>
              <label className="photo-panel-field">Alto (cm)<input type="number" min="0.1" step="0.1" value={(activeImage!.height*activeImage!.scale/10).toFixed(1)} onChange={event=>{const height=Number(event.target.value)*10;if(height>0){changeReference(activeImage!.id,{scale:height/activeImage!.height,calibrated:false});setPhotoScaleCalibrated(false)}}}/></label>
              <label className="photo-panel-field">Ángulo (°)<input type="number" step="0.1" value={(activeImage!.rotation??0).toFixed(1)} onChange={event=>changeReference(activeImage!.id,{rotation:Number(event.target.value)})}/></label>
              <div className="photo-actions"><button onClick={()=>changeReference(activeImage!.id,{flipX:!activeImage!.flipX})}>Voltear ↔</button><button onClick={()=>changeReference(activeImage!.id,{flipY:!activeImage!.flipY})}>Voltear ↕</button></div>
              <div className="photo-actions"><button onClick={()=>changeReference(activeImage!.id,{locked:!activeImage!.locked})}>{activeImage!.locked?'Desbloquear':'Bloquear'}</button><button onClick={()=>{const copy={...activeImage!,id:makeId(),name:`Copia de ${activeImage!.name}`,x:activeImage!.x+20,y:activeImage!.y+20,locked:false};const next=[...referenceImages,copy];setReferenceImages(next);setActiveImageId(copy.id);setSelectedImageId(copy.id);setSaved(false)}}>Duplicar</button></div>
              <label className="photo-opacity">Opacidad <input type="range" min="0.1" max="1" step="0.05" value={activeImage!.opacity} onChange={event => changeReference(activeImage!.id,{opacity:Number(event.target.value)})}/></label>
              {activeImage!.calibrated ? <small className="photo-good">Escala calibrada · {activeImage!.scale.toFixed(4)} mm/px</small> : <small className="photo-warning">Sin calibrar: no se garantiza el tamaño real.</small>}
              {Math.max(activeImage!.width,activeImage!.height)<1200 && <small className="photo-warning">La foto tiene poca resolución; revisa el enfoque antes de calcar.</small>}
              <small className="photo-help">Revisa también sombras, arrugas y deformación del papel. La imagen no es geometría digital hasta que la traces.</small>
              {referenceImages.length > 1 && <small className="photo-help">Varias fotos cargadas. Calibra cada una y ajusta X/Y para alinearlas.</small>}
              <button className="photo-remove" onClick={() => { const next=referenceImages.filter(image=>image.id!==activeImage!.id); setReferenceImages(next); if(next.length&&next.every(image=>image.calibrated))setPhotoScaleCalibrated(true); setActiveImageId(next[0]?.id??null); setPhotoMode(null); setPhotoPoints([]); setSaved(false) }}>Quitar esta foto</button>
            </>}
            {!activeImage && photoDerived && !photoScaleCalibrated && <small className="photo-warning">Este molde provino de una foto sin calibrar. Añade y calibra una referencia antes de imprimir a tamaño real.</small>}
            {photoError && <small className="photo-warning">{photoError}</small>}
          </div>}
          <svg ref={svgRef} className={`pattern-canvas ${tool !== 'select' || photoMode ? 'drawing' : ''}`} viewBox={`${viewX} ${viewY} ${visibleWidth} ${visibleHeight}`} preserveAspectRatio="none" onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerUp} onWheel={onWheel} onContextMenu={(event) => event.preventDefault()}>
            <defs><pattern id="small-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e9eaf1" strokeWidth="0.55" /></pattern><pattern id="major-grid" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#small-grid)" /><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#d8d9e5" strokeWidth="0.9" /></pattern></defs>
            <rect x={viewX} y={viewY} width={visibleWidth} height={visibleHeight} fill={gridVisible ? 'url(#major-grid)' : '#fff'} />
            <line x1={viewX} x2={viewX + visibleWidth} y1="0" y2="0" stroke="#c3c6d5" strokeWidth="1.3" /><line y1={viewY} y2={viewY + visibleHeight} x1="0" x2="0" stroke="#c3c6d5" strokeWidth="1.3" />
            {showReference && referenceImages.map(image => {const w=image.width*image.scale,h=image.height*image.scale,cx=image.x+w/2,cy=image.y+h/2,selectedPhoto=selectedImageId===image.id;return <g key={image.id} transform={`rotate(${image.rotation??0} ${cx} ${cy})`}>
              <image href={image.data} x={image.x} y={image.y} width={w} height={h} opacity={image.opacity} preserveAspectRatio="none" transform={image.flipX||image.flipY?`translate(${image.flipX?2*cx:0} ${image.flipY?2*cy:0}) scale(${image.flipX?-1:1} ${image.flipY?-1:1})`:undefined} style={{cursor:tool==='select'?(image.locked?'default':'move'):'crosshair',pointerEvents:'auto'}} onPointerDown={event=>onReferencePointerDown(event,image)} />
              {selectedPhoto&&<><rect x={image.x} y={image.y} width={w} height={h} fill="none" stroke="#7569e8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pointerEvents="none"/><line x1={cx} y1={image.y} x2={cx} y2={image.y-24/zoom} stroke="#7569e8" strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents="none"/><circle cx={cx} cy={image.y-30/zoom} r={6/zoom} fill="#fff" stroke="#7569e8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" style={{cursor:'grab'}} onPointerDown={event=>onReferencePointerDown(event,image,'rotate')}/>{[[image.x,image.y],[image.x+w,image.y],[image.x+w,image.y+h],[image.x,image.y+h]].map(([x,y],index)=><rect key={index} x={x-5/zoom} y={y-5/zoom} width={10/zoom} height={10/zoom} rx={2/zoom} fill="white" stroke="#7569e8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" style={{cursor:'nwse-resize'}} onPointerDown={event=>onReferencePointerDown(event,image,'resize')}/>)}</>}
            </g>})}
            {showProcessed && activeImage?.processed_data && <g transform={`rotate(${activeImage.rotation??0} ${activeImage.x+activeImage.width*activeImage.scale/2} ${activeImage.y+activeImage.height*activeImage.scale/2})`}><image href={activeImage.processed_data} x={activeImage.x} y={activeImage.y} width={activeImage.width*activeImage.scale} height={activeImage.height*activeImage.scale} opacity="0.9" preserveAspectRatio="none" style={{pointerEvents:'none'}}/></g>}
            {photoPoints.map((point,index) => <circle key={index} cx={point.x} cy={point.y} r="5" fill="#e77d35" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none"/>)}
            {Array.from({ length: 17 }, (_, index) => { const x = Math.round(viewX / 100) * 100 + index * 100; return <text key={`x${x}`} x={x + 3} y={Math.max(viewY + 13, 13)} className="axis-label">{(x / 10).toFixed(0)} cm</text> })}
            {Array.from({ length: 13 }, (_, index) => { const y = Math.round(viewY / 100) * 100 + index * 100; return <text key={`y${y}`} x={Math.max(viewX + 4, 4)} y={y - 3} className="axis-label">{(y / 10).toFixed(0)} cm</text> })}
            {items.map((item) => <EntityShape key={item.id} item={item} selected={selected.includes(item.id)} onPointerDown={onItemPointerDown} />)}
            {draft.length > 0 && <DraftShape tool={tool} draft={draft} preview={preview} />}
            {draft.length > 0 && preview && <circle cx={preview.x} cy={preview.y} r="3.5" className="draft-cursor" />}
          </svg>
          <div className="canvas-coordinate">{preview ? `${(preview.x / 10).toFixed(1)} cm, ${(preview.y / 10).toFixed(1)} cm` : 'X 0.0 cm · Y 0.0 cm'}</div>
          <div className="zoom-controls"><button onClick={() => setZoom((v) => Math.min(2.4, v * 1.2))} title="Acercar"><ZoomIn size={16} /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((v) => Math.max(0.2, v / 1.2))} title="Alejar"><ZoomOut size={16} /></button><span className="zoom-divider" /><button onClick={() => setCenter({ x: 0, y: 0 })} title="Centrar lienzo"><Hand size={15} /></button></div>
        </div>
        <div className="canvas-hint">{photoMode === 'move' ? 'Arrastra el lienzo para posicionar la foto y alinear varias imágenes' : photoMode === 'calibrate' ? `Calibración: marca dos puntos conocidos sobre la foto (${photoPoints.length}/2)` : photoMode === 'crop' ? `Recorte: marca dos esquinas del área (${photoPoints.length}/2)` : photoMode === 'perspective' ? `Perspectiva: marca las cuatro esquinas del papel en orden (${photoPoints.length}/4)` : tool === 'curve' && draft.length === 1 ? 'Marca el punto de control de la curva' : tool === 'curve' && draft.length === 2 ? 'Marca el punto final de la curva' : (tool === 'line' || tool === 'mark') && draft.length ? 'Marca el final de la línea' : tool === 'piece' && draft.length ? 'Agrega vértices y pulsa Enter para cerrar' : 'Rueda para zoom · Botón central para desplazar · Shift + clic para selección múltiple'}{tool === 'piece' && draft.length >= 3 && <button onClick={finishPolygon}><CornerDownLeft size={13} /> Cerrar contorno</button>}</div>
      </div>
      <aside className="editor-inspector"><div className="inspector-title"><span>PROPIEDADES</span><span>{selectedEntities.length ? `${selectedEntities.length} seleccionado${selectedEntities.length > 1 ? 's' : ''}` : 'LIENZO'}</span></div>
        {selectedItem ? <><div className="inspector-item-icon">{selectedItem.type === 'point' ? <Circle size={18} /> : selectedItem.type === 'line' ? <Minus size={18} /> : selectedItem.type === 'curve' ? <Spline size={18} /> : <Scissors size={18} />}</div><div className="inspector-type">{selectedItem.type === 'piece' ? 'Pieza vectorial cerrada' : selectedItem.type === 'curve' ? 'Curva Bézier' : selectedItem.type === 'line' ? selectedItem.markType ?? 'Línea / marca' : 'Punto de referencia'}</div><div className="inspector-measure"><small>{selectedItem.type === 'point' ? 'POSICIÓN' : selectedItem.type === 'piece' ? 'PERÍMETRO' : 'LONGITUD'}</small><strong>{selectedItem.type === 'point' ? `${cm(selectedItem.x)} · ${cm(selectedItem.y)}` : cm(entityLength(selectedItem))}</strong></div>
          {selectedItem.type === 'point' && <div className="inspector-numbers"><label>X (cm)<input type="number" step="0.1" value={(selectedItem.x/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{x:Number(event.target.value)*10})}/></label><label>Y (cm)<input type="number" step="0.1" value={(selectedItem.y/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{y:Number(event.target.value)*10})}/></label></div>}
          {selectedItem.type === 'line' && <><div className="inspector-numbers"><label>X inicio<input type="number" step="0.1" value={(selectedItem.x/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{x:Number(event.target.value)*10})}/></label><label>Y inicio<input type="number" step="0.1" value={(selectedItem.y/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{y:Number(event.target.value)*10})}/></label><label>X final<input type="number" step="0.1" value={(selectedItem.x2/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{x2:Number(event.target.value)*10})}/></label><label>Y final<input type="number" step="0.1" value={(selectedItem.y2/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{y2:Number(event.target.value)*10})}/></label></div><label className="inspector-field">Tipo<select value={selectedItem.markType??''} onChange={event=>updateItem(selectedItem.id,{markType:(event.target.value||undefined) as LineItem['markType']})}><option value="">Línea</option><option value="notch">Piquete</option><option value="dart">Pinza</option><option value="fold">Doblez</option><option value="internal">Línea interna</option></select></label><label className="inspector-field">Anotación<input value={selectedItem.label??''} onChange={event=>updateItem(selectedItem.id,{label:event.target.value})} placeholder="Nombre o nota"/></label>{!selectedItem.markType&&<button className="convert-curve" onClick={()=>convertLineToCurve(selectedItem)}><Spline size={13}/> Convertir segmento a curva</button>}</>}
          {selectedItem.type === 'curve' && <div className="inspector-numbers"><label>X inicio<input type="number" step="0.1" value={(selectedItem.x/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{x:Number(event.target.value)*10})}/></label><label>Y inicio<input type="number" step="0.1" value={(selectedItem.y/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{y:Number(event.target.value)*10})}/></label><label>X control<input type="number" step="0.1" value={(selectedItem.cx/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{cx:Number(event.target.value)*10})}/></label><label>Y control<input type="number" step="0.1" value={(selectedItem.cy/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{cy:Number(event.target.value)*10})}/></label><label>X final<input type="number" step="0.1" value={(selectedItem.x2/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{x2:Number(event.target.value)*10})}/></label><label>Y final<input type="number" step="0.1" value={(selectedItem.y2/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{y2:Number(event.target.value)*10})}/></label></div>}
          {selectedItem.type === 'piece' && <><label className="inspector-field">Nombre de pieza<input value={selectedItem.label??''} onChange={event=>updateItem(selectedItem.id,{label:event.target.value})} placeholder="Ej. Delantero"/></label><div className="inspector-numbers"><label>Ancho (cm)<input type="number" min="0.1" step="0.1" value={(Math.max(...selectedItem.vertices.map(p=>p.x))-Math.min(...selectedItem.vertices.map(p=>p.x)))/10} onChange={event=>resizePiece(selectedItem,'x',Number(event.target.value))}/></label><label>Alto (cm)<input type="number" min="0.1" step="0.1" value={(Math.max(...selectedItem.vertices.map(p=>p.y))-Math.min(...selectedItem.vertices.map(p=>p.y)))/10} onChange={event=>resizePiece(selectedItem,'y',Number(event.target.value))}/></label></div><label className="inspector-field">Margen de costura (cm)<input type="number" min="0" step="0.1" value={((selectedItem.seamAllowanceMm??0)/10).toFixed(1)} onChange={event=>updateItem(selectedItem.id,{seamAllowanceMm:Math.max(0,Number(event.target.value)*10)})}/></label></>}
          <div className="inspector-coords"><span>Medidas reales en centímetros</span><p>Almacenamiento geométrico en milímetros. Cambiar el zoom no altera las medidas.</p></div></> : selectedEntities.length > 1 ? <div className="inspector-empty">Arrastra una pieza para mover la selección.</div> : <div className="inspector-empty"><div className="inspector-empty-icon"><MousePointer2 size={20} /></div><strong>Selecciona un elemento</strong><span>Elige un punto, línea, curva o contorno para ver su medida.</span></div>}
        {patternId && <section className="inspector-history"><button onClick={openVersions}><History size={14} /> Historial de versiones</button>{showVersions && versions.map((entry) => <div className="version-row" key={entry.version}><span><strong>Versión {entry.version}</strong><small>{new Date(entry.created_at).toLocaleString('es-CL')}</small></span><button onClick={() => restoreVersion(entry.version)}>Restaurar</button></div>)}</section>}
        <div className="inspector-bottom"><div className="inspector-stats"><span>Elementos</span><strong>{items.length}</strong></div><div className="inspector-stats"><span>Unidad de trabajo</span><strong>cm</strong></div><div className="inspector-stats"><span>Ajuste a cuadrícula</span><strong>{snap ? '10 mm' : 'Desactivado'}</strong></div><button className="export-geometry" onClick={() => downloadGeometry(name, items)}><Download size={14} /> Exportar geometría JSON</button></div>
      </aside>
    </div>
    <div className="editor-footer"><span><i className="footer-online" /> {saved ? 'Guardado' : 'Cambios sin guardar'}</span><span>{items.length} elemento{items.length === 1 ? '' : 's'}</span><span>Medidas en centímetros · Geometría en milímetros</span></div>
  </div>
}

function entityPoints(entity: Entity): XY[] {
  if (entity.type === 'piece') return entity.vertices
  if (entity.type === 'point') return [entity]
  if (entity.type === 'line') return [{ x: entity.x, y: entity.y }, { x: entity.x2, y: entity.y2 }]
  return [{ x: entity.x, y: entity.y }, { x: entity.cx, y: entity.cy }, { x: entity.x2, y: entity.y2 }]
}

function rotateEntity(entity: Entity, pivot: XY): Entity {
  const rotate = (point: XY) => ({ x: pivot.x - (point.y - pivot.y), y: pivot.y + (point.x - pivot.x) })
  if (entity.type === 'piece') return { ...entity, vertices: entity.vertices.map(rotate) }
  if (entity.type === 'point') return { ...entity, ...rotate(entity) }
  const start = rotate(entity), end = rotate({ x: entity.x2, y: entity.y2 })
  if (entity.type === 'line') return { ...entity, x: start.x, y: start.y, x2: end.x, y2: end.y }
  const control = rotate({ x: entity.cx, y: entity.cy })
  return { ...entity, x: start.x, y: start.y, cx: control.x, cy: control.y, x2: end.x, y2: end.y }
}

function moveEntity(entity: Entity, dx: number, dy: number, vertex?: number | 'control' | 'start' | 'end'): Entity {
  if (entity.type === 'piece') return { ...entity, vertices: entity.vertices.map((point, index) => vertex === index ? { x: point.x + dx, y: point.y + dy } : vertex === undefined ? { x: point.x + dx, y: point.y + dy } : point) }
  if (entity.type === 'point') return { ...entity, x: entity.x + dx, y: entity.y + dy }
  if (entity.type === 'line') {
    if (vertex === 'start') return { ...entity, x: entity.x + dx, y: entity.y + dy }
    if (vertex === 'end') return { ...entity, x2: entity.x2 + dx, y2: entity.y2 + dy }
    return { ...entity, x: entity.x + dx, y: entity.y + dy, x2: entity.x2 + dx, y2: entity.y2 + dy }
  }
  if (vertex === 'start') return { ...entity, x: entity.x + dx, y: entity.y + dy }
  if (vertex === 'end') return { ...entity, x2: entity.x2 + dx, y2: entity.y2 + dy }
  if (vertex === 'control') return { ...entity, cx: entity.cx + dx, cy: entity.cy + dy }
  return { ...entity, x: entity.x + dx, y: entity.y + dy, cx: entity.cx + dx, cy: entity.cy + dy, x2: entity.x2 + dx, y2: entity.y2 + dy }
}

function EntityShape({ item, selected, onPointerDown }: { item: Entity; selected: boolean; onPointerDown: (event: PointerEvent<SVGElement>, item: Entity, vertex?: number | 'control' | 'start' | 'end') => void }) {
  const common = { onPointerDown: (event: PointerEvent<SVGElement>) => onPointerDown(event, item), 'data-item-id': item.id, className: `entity ${selected ? 'selected' : ''}` }
  return <g {...common}>
    {item.type === 'point' && <><circle cx={item.x} cy={item.y} r="5" className="pattern-point" /><circle cx={item.x} cy={item.y} r="15" className="hit-area" /></>}
    {item.type === 'line' && <><line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className={`pattern-line ${item.markType ? `pattern-mark mark-${item.markType}` : ''}`} /><line x1={item.x} y1={item.y} x2={item.x2} y2={item.y2} className="hit-area-line" />{item.label && <text x={(item.x+item.x2)/2} y={(item.y+item.y2)/2-12} className="pattern-label">{item.label}</text>}{selected && <><circle cx={item.x} cy={item.y} r="4" className="vertex-handle" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item, 'start') }} /><circle cx={item.x2} cy={item.y2} r="4" className="vertex-handle" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item, 'end') }} /></>}</>}
    {item.type === 'curve' && <><path d={`M ${item.x} ${item.y} Q ${item.cx} ${item.cy} ${item.x2} ${item.y2}`} className="pattern-curve" /><path d={`M ${item.x} ${item.y} Q ${item.cx} ${item.cy} ${item.x2} ${item.y2}`} className="hit-area-curve" />{selected && <><line x1={item.x} y1={item.y} x2={item.cx} y2={item.cy} className="control-guide" /><line x1={item.x2} y1={item.y2} x2={item.cx} y2={item.cy} className="control-guide" /><circle cx={item.cx} cy={item.cy} r="5" className="control-point" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item, 'control') }} /><circle cx={item.x} cy={item.y} r="4" className="vertex-handle" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item, 'start') }} /><circle cx={item.x2} cy={item.y2} r="4" className="vertex-handle" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item, 'end') }} /></>}</>}
    {item.type === 'piece' && <><polygon points={item.vertices.map((point) => `${point.x},${point.y}`).join(' ')} className="pattern-piece" />{(item.seamAllowanceMm??0)>0 && <polygon points={offsetPolygon(item.vertices,item.seamAllowanceMm??0).map(point=>`${point.x},${point.y}`).join(' ')} className="seam-allowance"/>}<polygon points={item.vertices.map((point) => `${point.x},${point.y}`).join(' ')} className="hit-area-piece" />{item.label && <text x={item.vertices.reduce((sum,p)=>sum+p.x,0)/item.vertices.length} y={item.vertices.reduce((sum,p)=>sum+p.y,0)/item.vertices.length} textAnchor="middle" className="pattern-label">{item.label}</text>}{selected && item.vertices.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4.5" className="vertex-handle" onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, item, index) }} />)}</>}
  </g>
}

function DraftShape({ tool, draft, preview }: { tool: Tool; draft: XY[]; preview: XY | null }) {
  const points = preview ? [...draft, preview] : draft
  if ((tool === 'line' || tool === 'mark') && points.length >= 1) return <line x1={points[0].x} y1={points[0].y} x2={points[1]?.x ?? points[0].x} y2={points[1]?.y ?? points[0].y} className="draft-line" />
  if (tool === 'curve' && points.length > 0) {
    if (draft.length === 1 && preview) return <line x1={draft[0].x} y1={draft[0].y} x2={preview.x} y2={preview.y} className="draft-line" />
    if (draft.length === 2 && preview) return <path d={`M ${draft[0].x} ${draft[0].y} Q ${draft[1].x} ${draft[1].y} ${preview.x} ${preview.y}`} className="draft-line" />
  }
  if (tool === 'piece' && points.length > 1) return <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} className="draft-piece" />
  return null
}

function downloadGeometry(name: string, items: Entity[]) {
  const data = new Blob([JSON.stringify({ name, unit: 'mm', items }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(data), anchor = document.createElement('a')
  anchor.href = url; anchor.download = `${name.trim().replace(/[^a-z0-9-_]+/gi, '-') || 'molde'}.json`; anchor.click(); URL.revokeObjectURL(url)
}
