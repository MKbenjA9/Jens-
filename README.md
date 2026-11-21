# Patronaje Pro

Aplicación local para gestionar patronaje y confección textil: productos, tallas, materiales, fichas técnicas, editor vectorial e impresión a tamaño real.

## Requisitos

- Node.js 20.19+ o 22.12+
- Python 3.10+

## Inicio local en Windows

Instala Node.js 20.19+ y Python 3.10+ una vez. Luego haz doble clic en **Iniciar Patronaje Pro.bat**. La primera vez instala las dependencias; después abre la aplicación en el navegador. Mantén abiertas las dos ventanas de servicio mientras la usas y ciérralas al terminar.

Los datos permanecen en ese computador, en `data/patronaje.db`. Copia ese archivo para hacer una copia de seguridad.

## Inicio manual

Instala las dependencias de interfaz con `npm ci` y las del servidor con `python -m pip install -r backend/requirements.txt`. Después, abre dos terminales en la carpeta del proyecto:

```powershell
python -m uvicorn backend.main:app --reload
```

```powershell
npm run dev
```

Abre la dirección local que muestra Vite. La base SQLite se crea automáticamente en `data/patronaje.db` al iniciar el servidor.

## GitHub Pages

El workflow de GitHub Actions publica automáticamente la interfaz al hacer push a `main`.

GitHub Pages solo sirve archivos estáticos y no ejecuta el servidor FastAPI, así que el enlace público no es la versión de trabajo. Usa el lanzador local para trabajar con productos, moldes y fichas; los datos se guardan en el equipo donde se inicia la aplicación.

## Notas de arquitectura

- React y TypeScript presentan la interfaz; FastAPI expone la API local.
- SQLite es la fuente persistente de productos y entidades relacionadas.
- La geometría del molde se almacena en milímetros, independientemente del zoom del editor.
- Las fotos de referencia se guardan junto a la geometría y con el historial del molde; no se consideran geometría digital por sí solas.
- OpenCV procesa las fotos de referencia localmente para proponer contornos, líneas y esquinas como candidatos vectoriales.
- Las cantidades de material distinguen datos manuales de estimaciones.
- La base de datos y los archivos de trabajo deberán respaldarse juntos.

## Digitalizar desde fotografías

En el editor abre **Foto**, importa una o varias imágenes JPG/PNG (hasta 2,5 MB cada una y 9,5 MB de datos serializados por molde), corrige la orientación, recorta o marca las cuatro esquinas para corregir la perspectiva. Calibra cada fotografía con dos puntos cuya distancia real conozcas. Para unir fotos, calibra cada una y alinéala con **Mover / unir** o con sus coordenadas X/Y.

Pulsa **Procesar y detectar vectores** para limpiar ruido y contraste y producir una capa transparente y candidatos de contorno, segmento y esquina. Prueba los métodos de umbral y la sensibilidad. La clasificación de línea exterior/interior es una sugerencia por proximidad; selecciona y revisa los candidatos antes de añadirlos al patrón. No se reconocen automáticamente pinzas, piquetes ni medidas; corrígelos o dibújalos con las herramientas del editor. La fotografía original permanece guardada.

Selecciona cada pieza para asignar nombre, cambiar sus dimensiones en centímetros y definir el margen de costura. Guarda el molde para registrar una versión. La impresión a tamaño real queda bloqueada mientras la escala fotográfica no esté calibrada; el PDF se obtiene con el diálogo de impresión y debe comprobarse con la regla de 10 × 10 cm.

La calibración depende de una distancia real correcta y de una foto nítida, plana y bien corregida. Sombras, arrugas, bordes borrosos o un papel deformado pueden producir errores; revísalos antes de cortar.

## Fichas de confección visuales

En **Fichas técnicas → Confección**, genera la ficha desde un producto. El lienzo parte del código, nombre, materiales, operaciones y fotografía del producto. Inserta las vistas frontal/trasera, dibujos, anotaciones, flechas, líneas, recuadros y tablas; mueve y redimensiona cada elemento, edita sus coordenadas, giro, tipografía y color. Si el producto tiene moldes vinculados, puedes insertar su geometría como SVG de referencia. Guarda una nueva versión de la ficha o guarda el diseño como plantilla. La plantilla conserva el maquetado; cada ficha guarda sus propias imágenes y textos sin actualizar el producto.

La página admite A4/A3 vertical u horizontal y se exporta con **Imprimir / PDF** del navegador. El archivo de referencia mencionado en el requerimiento no llegó como PDF o imagen independiente, así que la composición inicial se basó en la estructura descrita.
