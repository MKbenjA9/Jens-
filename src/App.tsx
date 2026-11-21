import { useEffect, useState } from 'react'
import {
  Activity, Archive, ArrowDownRight, ArrowUpRight, BookOpen,
  Clock3, FileCheck2, FileText, Layers3,
  LayoutDashboard, Search, Shirt, Scissors, Sparkles, Library,
  SwatchBook, Ruler, Printer, ScanLine, type LucideIcon,
} from 'lucide-react'
import Editor from './Editor'
import { ProductsPage } from './Products'
import { MaterialsPage, SizesPage } from './Production'
import { SheetsPage } from './Sheets'
import PrintingPage from './Printing'
import DigitalizePage from './Digitalize'
import { MyPatternsPage } from './MyPatterns'

type Section = 'Inicio' | 'Productos' | 'Mis moldes' | 'Editor de moldes' | 'Digitalizar molde' | 'Tallas y medidas' | 'Materiales' | 'Fichas técnicas' | 'Impresión'
type Overview = { products: number; patterns: number; technical_sheets: number; measurement_sheets: number; recent_products: { id: number; code: string; name: string; category: string; updated_at: string }[] }

const nav: { label: Section; icon: LucideIcon; phase: string }[] = [
  { label: 'Inicio', icon: LayoutDashboard, phase: 'Disponible' },
  { label: 'Productos', icon: Shirt, phase: 'Disponible' },
  { label: 'Mis moldes', icon: Library, phase: 'Disponible' },
  { label: 'Editor de moldes', icon: Scissors, phase: 'Etapa 2' },
  { label: 'Digitalizar molde', icon: ScanLine, phase: 'Disponible' },
  { label: 'Tallas y medidas', icon: Ruler, phase: 'Disponible' },
  { label: 'Materiales', icon: SwatchBook, phase: 'Disponible' },
  { label: 'Fichas técnicas', icon: FileText, phase: 'Disponible' },
  { label: 'Impresión', icon: Printer, phase: 'Disponible' },
]

const emptyOverview: Overview = { products: 0, patterns: 0, technical_sheets: 0, measurement_sheets: 0, recent_products: [] }

function App() {
  const localOnly = window.location.hostname.endsWith('.github.io')
  const [section, setSection] = useState<Section>('Inicio')
  const [overview, setOverview] = useState<Overview>(emptyOverview)
  const [connected, setConnected] = useState(false)
  const [query, setQuery] = useState('')
  const [patternToOpen, setPatternToOpen] = useState<number | null>(null)

  useEffect(() => {
    if (localOnly) return
    fetch('/api/overview')
      .then((response) => { if (!response.ok) throw new Error(); return response.json() as Promise<Overview> })
      .then((data) => { setOverview(data); setConnected(true) })
      .catch(() => setConnected(false))
  }, [section, localOnly])

  if (localOnly) return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f6f7fb' }}>
    <section style={{ maxWidth: 620, padding: 36, borderRadius: 14, background: '#fff', boxShadow: '0 12px 36px #252c4410' }}>
      <div className="brand-copy"><strong style={{ color: '#1b2340' }}>patronaje<span>pro</span></strong><small style={{ color: '#929bb6' }}>ESTUDIO TEXTIL</small></div>
      <h1 style={{ marginTop: 32 }}>Esta aplicación se usa en el computador</h1>
      <p style={{ color: '#697187', lineHeight: 1.7 }}>GitHub Pages solo publica la interfaz; no ejecuta la API ni guarda tus datos. Por eso aparecía el error 404. Descarga la versión local y ábrela en el computador donde se trabajará.</p>
      <a href="https://github.com/MKbenjA9/Jens-/archive/refs/heads/main.zip" style={{ display: 'inline-block', padding: '12px 18px', borderRadius: 8, background: '#7566ef', color: '#fff', fontWeight: 600, textDecoration: 'none' }}>Descargar versión local</a>
      <p style={{ marginTop: 22, color: '#858c9e', fontSize: 13, lineHeight: 1.7 }}>Descomprime el archivo, instala Python 3.10+ y Node.js 20.19+ y abre <strong>Iniciar Patronaje Pro.bat</strong>. Los moldes y productos se guardarán en ese computador.</p>
    </section>
  </main>

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#inicio" onClick={() => setSection('Inicio')} aria-label="Patronaje Pro, inicio">
        <span className="brand-mark"><Scissors size={21} strokeWidth={2.2} /></span>
        <span className="brand-copy"><strong>patronaje<span>pro</span></strong><small>ESTUDIO TEXTIL</small></span>
      </a>
      <div className="workspace"><span className="workspace-icon"><Layers3 size={17} /></span><span><strong>Mi taller</strong><small>Espacio de trabajo</small></span></div>
      <div className="nav-label">ESPACIO DE TRABAJO</div>
      <nav className="main-nav" aria-label="Navegación principal">
        {nav.map(({ label, icon: Icon, phase }) => <button key={label} className={`nav-item ${section === label ? 'active' : ''}`} onClick={() => setSection(label)} aria-current={section === label ? 'page' : undefined}>
          <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{phase !== 'Disponible' && <span className="phase-dot" aria-label={phase} />}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className={`connection ${connected ? 'online' : ''}`}><span className="status-dot" /><span>{connected ? 'Base de datos conectada' : 'API sin conexión'}</span></div>
        <div className="profile"><div className="avatar">MT</div><div className="profile-name"><strong>Mi taller</strong><small>Cuenta local</small></div></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumbs"><span>Espacio de trabajo</span><span className="crumb-sep">/</span><strong>{section}</strong></div>
        <div className="topbar-actions"><label className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en el espacio…" aria-label="Buscar" /></label><div className="top-avatar">MT</div></div>
      </header>

      {section === 'Inicio' ? <Dashboard overview={overview} query={query} onNavigate={setSection} />
        : section === 'Editor de moldes' ? <Editor onExit={() => setSection('Inicio')} initialPatternId={patternToOpen} />
        : section === 'Mis moldes' ? <MyPatternsPage onOpenEditor={(id) => { setPatternToOpen(id || null); setSection('Editor de moldes') }} />
        : section === 'Digitalizar molde' ? <DigitalizePage onOpenEditor={(id) => { setPatternToOpen(id); setSection('Editor de moldes') }} />
        : section === 'Productos' ? <ProductsPage onManageSizes={() => setSection('Tallas y medidas')} onManageMaterials={() => setSection('Materiales')} onOpenEditor={() => { setPatternToOpen(null); setSection('Editor de moldes') }} />
        : section === 'Tallas y medidas' ? <SizesPage onProducts={() => setSection('Productos')} />
        : section === 'Materiales' ? <MaterialsPage onProducts={() => setSection('Productos')} />
        : section === 'Fichas técnicas' ? <SheetsPage onProducts={() => setSection('Productos')} />
        : <PrintingPage />}
    </main>
  </div>
}

function Dashboard({ overview, query, onNavigate }: { overview: Overview; query: string; onNavigate: (section: Section) => void }) {
  const cards = [
    { title: 'Productos', count: overview.products, caption: 'Modelos registrados', icon: Shirt, color: 'lavender' },
    { title: 'Moldes', count: overview.patterns, caption: 'Piezas guardadas', icon: Scissors, color: 'blue' },
    { title: 'Fichas de confección', count: overview.technical_sheets, caption: 'Documentos creados', icon: FileCheck2, color: 'mint' },
    { title: 'Fichas de determinación', count: overview.measurement_sheets, caption: 'Tablas de medidas', icon: Ruler, color: 'peach' },
  ]
  const filtered = overview.recent_products.filter((product) => `${product.name} ${product.code} ${product.category}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="page-wrap">
    <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> {new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('es-CL')}</div><h1>Tu taller, en orden<span className="title-dot">.</span></h1><p className="subtitle">Aquí tienes un resumen de lo que está pasando en tu espacio de trabajo.</p></div><button className="primary-button" onClick={() => onNavigate('Editor de moldes')}><Scissors size={16} /> Abrir editor <span className="button-arrow">↗</span></button></div>
    <section className="stats-grid" aria-label="Resumen del taller">{cards.map(({ title, count, caption, icon: Icon, color }, index) => <article className="stat-card" key={title}><div className="stat-top"><span className={`stat-icon ${color}`}><Icon size={19} /></span><span className="stat-trend"><ArrowUpRight size={14} /> {index === 0 ? 'En tu taller' : 'Vinculados'}</span></div><div className="stat-count">{count.toString().padStart(2, '0')}</div><div className="stat-title">{title}</div><div className="stat-caption">{caption}</div></article>)}</section>

    <div className="content-grid">
      <section className="panel recent-panel"><div className="panel-heading"><div><div className="panel-kicker">SEGUIMIENTO</div><h2>Actividad reciente</h2></div><button className="text-button" onClick={() => onNavigate('Productos')}>Ver productos <ArrowUpRight size={15} /></button></div>
        {filtered.length ? <div className="recent-list">{filtered.map((product) => <div className="recent-row" key={product.id}><div className="product-glyph"><Shirt size={20} /></div><div className="recent-name"><strong>{product.name}</strong><span>{product.code} · {product.category}</span></div><span className="recent-date">{new Date(product.updated_at).toLocaleDateString('es-CL')}</span><ArrowDownRight size={16} className="row-arrow" /></div>)}</div> : <div className="empty-state"><div className="empty-illustration"><Archive size={25} /></div><strong>Aún no hay productos</strong><span>Cuando registres modelos, aparecerán aquí con su última actividad.</span><button onClick={() => onNavigate('Productos')}>Explorar productos <ArrowUpRight size={14} /></button></div>}
      </section>
      <aside className="right-column">
        <section className="panel quick-panel"><div className="panel-kicker">ACCESO DIRECTO</div><h2>¿Qué necesitas hacer?</h2><button className="quick-action" onClick={() => onNavigate('Editor de moldes')}><span className="quick-icon purple"><Scissors size={17} /></span><span><strong>Abrir editor de moldes</strong><small>Construye piezas con precisión</small></span><ArrowUpRight size={15} /></button><button className="quick-action" onClick={() => onNavigate('Productos')}><span className="quick-icon blue"><Shirt size={17} /></span><span><strong>Ir a productos</strong><small>Organiza tus modelos</small></span><ArrowUpRight size={15} /></button><button className="quick-action" onClick={() => onNavigate('Materiales')}><span className="quick-icon orange"><SwatchBook size={17} /></span><span><strong>Revisar materiales</strong><small>Telas e insumos del taller</small></span><ArrowUpRight size={15} /></button></section>
        <section className="tip-card"><div className="tip-spark"><Sparkles size={18} /></div><div className="tip-content"><strong>Un espacio para cada prenda</strong><p>Vincula moldes, tallas y materiales desde el producto para mantener toda la información conectada.</p></div><div className="tip-decoration"><span /><span /><span /></div></section>
        <div className="support-note"><Clock3 size={14} /><span>Todo tu trabajo se guarda en este equipo.</span><BookOpen size={14} /></div>
      </aside>
    </div>
    <footer className="dashboard-footer"><span><span className="footer-mark">P</span> Patronaje Pro <span className="footer-version">· Fase 1</span></span><span>Diseñado para el trabajo real de tu taller</span><span className="footer-db"><Activity size={13} /> Datos locales</span></footer>
  </div>
}

export default App
