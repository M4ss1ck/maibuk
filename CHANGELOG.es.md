# Registro de cambios

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
y este proyecto sigue el [Versionado Semántico](https://semver.org/spec/v2.0.0.html).

## [0.17.0] - 2026-10-29

### Added
- Plugin integrado Reader para PDF, EPUB, MOBI, AZW3, FB2 y CBZ, con estantería de portadas en cuadrícula y permisos de archivo para archivos seleccionados
- Filtro de notas en la barra lateral de la lista de notas
- Desplazamiento continuo para PDF (alternador de barra de herramientas y comando), guardado como pdfLayout
- Lectura a pantalla completa desde la barra de herramientas o F; Escape sale primero de pantalla completa
- Paginación con rueda del ratón en los bordes de página, zoom con Ctrl+rueda, y toques y deslizamientos táctiles para paginar
- Barra de herramientas de iconos con información sobre herramientas y botones de página anterior y siguiente

### Changed
- Los módulos de plugin se planifican en un Worker de un solo uso, liberando memoria de WebAssembly
- El texto fluido sigue el tema en vivo sin colores oscuros incrustados al cargar
- Los plugins bajo demanda pueden omitir el calentamiento mediante la opción de manifiesto warmStart "intent"
- Los marcos pueden solicitar pantalla completa al host

### Fixed
- La vigilancia del directorio de plugins ignoraba los eventos de lectura, corrigiendo un bucle de recarga infinito
- Las páginas PDF se repintan correctamente cuando se muestran de nuevo desde su mapa de bits
- Al relanzar a la página de lectura se reabre el documento abierto
- La paleta mantiene el foco cuando se inicia el último comando
- La coincidencia de búsqueda actual se resalta y se mueve con Siguiente y Anterior
- La liberación de permisos de archivo rechaza permisos desconocidos e informa fallos de escritura; los documentos de 0 bytes ya no leen un rango de longitud cero
- Pulido del popover del filtro de notas: información sobre herramientas, teclado de lista de etiquetas, insignia e iconos de etiqueta
- Foco del filtro de notas tras Limpiar, atajo fuera del editor y Tab cerrando listas de etiquetas

## [0.16.0] - 2026-10-24

### Added
- Búsqueda de la Biblioteca en toda la Biblioteca, con fragmentos, recuentos de resultados y estado de indexación
- Modo comandos en la paleta de comandos, abierto con `>` y Búsqueda de la Biblioteca sin prefijo
- Opciones Coincidir mayúsculas y minúsculas, Palabra completa y Regex dentro del campo de Búsqueda de la Biblioteca
- Abrir un resultado de la Búsqueda de la Biblioteca en su primera coincidencia en Buscar y Reemplazar, o abrir el Canvas de la nota desde su tarjeta
- Un método `library.search` de la API de complementos y una herramienta `search_library` de MCP
- Notas de la versión en todos los idiomas de la aplicación, con el idioma del autor como respaldo para las versiones más recientes

### Changed
- La Biblioteca web funciona con SQLite WASM sobre OPFS para un almacenamiento y una búsqueda más fiables
- La Búsqueda de la Biblioteca y Buscar y Reemplazar ignoran los acentos

### Fixed
- La Biblioteca web carga el WASM de sql.js incluido en lugar de un CDN, lo que evita errores de enlace
- La Biblioteca de tutoriales se abre correctamente cuando se carga el código de exportación a EPUB
- La Biblioteca de escritorio se abre con el índice de búsqueda FTS5 habilitado
- Restablecer todo en el Editor de atajos devuelve el foco al campo de búsqueda
- Arrastrar una nota mientras la lista está ordenada ya no la quita de la barra lateral
- Una consulta de Búsqueda de la Biblioteca introducida durante la reconstrucción del índice se vuelve a ejecutar cuando finaliza la indexación
- Filtrar por Libro en la Búsqueda de la Biblioteca de complementos devuelve páginas exactas

## [0.15.2] - 2026-10-23

### Changed
- La pantalla de inicio usa el tema seleccionado desde el primer fotograma, incluida una instantánea del tema de arranque persistida y un estado de carga localizado
- La ventana de escritorio se abre con el fondo del tema en lugar de blanco

### Fixed
- La ventana principal aparece solo después de cargar su página, con un respaldo, lo que evita un destello blanco en WebKitGTK
- Las vistas incrustadas aplican su propio tema en el primer fotograma y las capturas de entrada obsoletas caducan

## [0.15.1] - 2026-10-22

### Added
- Muestra un marcador de advertencia y el motivo de los Plugins detenidos en la barra lateral, en escritorio y móvil
- Añade un panel de Plugin detenido con el motivo y las acciones Reintentar y Revisar en Ajustes
- Mantiene marcadas para el siguiente inicio las entradas de barra lateral guardadas de Plugins activados que se rechazaron
- Muestra la hora del día de las notas editadas hoy en las filas de la barra lateral, con la fecha de edición completa al pasar el puntero y como descripción de la fila enfocada

### Changed
- Etiqueta los destinos internos del diálogo de enlace como «En Maibuk» en lugar de «En este libro»

### Fixed
- Evita que el foco restaurado de la ventana muestre anillos de foco de teclado tras Alt+Tab, clics en la barra de tareas o al restaurar la ventana con el ratón
- Elimina los dependientes de un Libro o Capítulo junto con él en todas las plataformas, incluidos enlaces, metadatos de EPUB, estilos, metadatos, recursos y capítulos
- Evita que lecturas obsoletas reordenen la Galería de Notas, la Biblioteca y las galerías de Lienzos
- Muestra las entradas de barra lateral de los Plugins activados en el primer fotograma en lugar de esperar a la sincronización de inicio o a las comprobaciones de sesión

## [0.15.0] - 2026-10-22

### Changed
- Las Versiones se guardan como manifiestos sobre contenido compartido, así el texto sin cambios de Capítulo y Portada se guarda una sola vez y se reduce el tamaño de la Biblioteca
- La retención de versiones es única en todos los dispositivos y en el servidor de sincronización: se conservan las 10 Versiones más recientes del último día, la más reciente por día UTC durante 14 días y la más reciente por semana durante 8 semanas, mientras que las Versiones nombradas, previas a una restauración y de Plugin se conservan siempre
- La retención de versiones se aplica antes de recibir cambios durante la sincronización, y las Versiones descartadas se marcan como lápidas
- La actualización del almacenamiento se ejecuta al iniciar tras una Copia de seguridad de protección; descarta huérfanos y convierte filas en línea por lotes; si la Copia de seguridad de protección falla, los datos no se tocan y se avisa al autor
- La actualización del almacenamiento se ejecuta de nuevo tras una Restauración, la carga de un Archivo de Base de Datos, un Reinicio de la biblioteca o al terminar el Tutorial
- Las Copias de seguridad y los Archivos de Base de Datos siguen siendo autónomos en el formato de volcado 2; una fila antigua de Libro completo cargada sobre datos divididos vuelve al modo en línea

### Fixed
- Los Puntos de control depurados ya no reaparecen durante la sincronización

## [0.14.1] - 2026-10-21

### Fixed
- Mantiene los anillos de foco de las filas de la barra lateral totalmente visibles dentro del área desplazable de destinos
- Permite que la navegación por teclado de la barra lateral llegue a destinos fijados como Métricas y Configuración

## [0.14.0] - 2026-10-21

### Added
- Añade el Servidor MCP como plugin integrado con una página dedicada para fragmentos de agente, gestión de claves, conexiones en vivo y un registro de actividad con límite
- Añade herramientas MCP para leer Libros, Capítulos y Notas con filtrado, paginación, extractos, ventanas y opciones de formato
- Añade herramientas MCP para crear, editar, reemplazar, mover y eliminar Capítulos y Notas, además de actualizar los detalles de un Libro
- Añade el modo de solo lectura de MCP y Puntos de control automáticos antes de la primera escritura de una conexión en un Libro
- Añade a la API de Plugins compatibilidad con los campos y escrituras de Libros, Capítulos y Notas, incluido el reordenado de Capítulos, las Etiquetas de Notas y la asignación de Notas a un Libro, y los Puntos de control creados por Plugins
- Añade el permiso serve y el Endpoint de Plugin para los plugins que reciben solicitudes HTTP
- Añade APIs de dirección del Endpoint de Plugin para que los plugins con serve descubran su URL y reaccionen cuando cambia

### Changed
- Mantiene estable el puerto del Endpoint de Plugin entre inicios y solo lo cambia cuando otra aplicación lo ocupa
- Protege las escrituras de plugins y MCP de sobrescribir ediciones más recientes del autor
- Perfecciona el estado de la página del Servidor MCP para la regeneración de claves, las claves ausentes, la duración de las conexiones y las marcas de tiempo de actividad

### Fixed
- Corrige la compatibilidad del Servidor MCP en entornos de sandbox de origen opaco
- Corrige la limpieza del Endpoint de Plugin y el manejo de respuestas para solicitudes abandonadas y respuestas sin cuerpo
- Evita que se depuren los Puntos de control creados por Plugins

## [0.13.2] - 2026-10-20

### Added
- Añade un ajuste de Signos de apertura en español que inserta ¿ y ¡ al escribir preguntas y exclamaciones
- Copia un Símbolo elegido desde el diálogo de Símbolos y accede a las acciones Insertar y Copiar desde su menú de elemento

### Fixed
- Evita que el marcador de posición se muestre detrás de un dictado parcial en un Capítulo o una Nota rápida vacíos

## [0.13.1] - 2026-10-19

### Added
- Muestra la versión de cada Plugin junto a su nombre en Configuración

### Changed
- Virtualiza la lista de Notas, el árbol de Notas, la Galería y la lista de Capítulos para mantener ágiles las bibliotecas grandes
- Retrasa la serialización del editor hasta que la escritura se asienta, para una escritura más fluida en WebKit
- Reduce el trabajo de maquetación de la paleta de comandos al abrirla y al escribir
- Hace más fluido el redimensionado de la lista de Capítulos en WebKit
- Rasteriza la marca de agua del lienzo una vez por nivel de zoom para un desplazamiento más fluido en WebKit
- Aísla el editor durante el reordenado de Capítulos con teclado para evitar bloqueos de reestilizado

### Fixed
- Evita que cerrar el menú contextual del editor robe el foco o cierre un menú recién reabierto
- Conserva la navegación por teclado en los bordes del árbol de Notas y la Galería cuando las filas están virtualizadas
- Hace enfocables y alternables con Intro los encabezados de grupo del árbol de Notas, y restaura el foco del cambio de nombre en línea
- Mantiene las filas táctiles de la paleta de comandos en 44px para que no se solapen
- Permite que el foco al eliminar un Capítulo llegue a los vecinos fuera de pantalla
- Hace que los destinos de reordenado por arrastrar y soltar y las animaciones FLIP toleren filas virtualizadas

## [0.13.0] - 2026-10-18

### Added
- Control de orden para la barra lateral de Notas, compartido con la Galería, con orden Personalizado, de la A a la Z, de la Z a la A y Última edición (más reciente o más antigua primero)
- Indicador de agarre con flecha para que la opción de orden Personalizado se lea como un orden
- Colores de resaltado de ecos asignados por Eco, con una paleta Okabe-Ito adaptada
- Selector de paleta para los resaltados de ecos con las paletas Okabe-Ito, Vivos y Suaves
- Interruptor «Alternar resaltados de ecos» persistente que se mantiene activo entre editores, reinicios y paradas de Plugins
- Icono de la barra de herramientas para Ecos dibujado con elementos SVG en línea
- Los iconos del manifiesto de Plugin pueden usar elementos SVG en línea en una cuadrícula de 24x24
- Las opciones de Plugin Select pueden mostrar hasta 12 colores de muestra decorativos

### Changed
- API de Plugins actualizada a 0.1.1, con Ecos declarando `^0.1.1` y versión 0.2.0

### Fixed
- El cursor de puntero aparece ahora en las tarjetas de galería de Libros, Notas y Lienzos, y las tarjetas de Lienzo intensifican su sombra al pasar el puntero en lugar de elevarse
- El menú contextual de ortografía ya no cierra la aplicación cuando cambian los elementos de sugerencias
- Los resaltados de Ecos funcionan antes de colocar el cursor y en el editor Efímero
- El interruptor de resaltados de ecos responde con fiabilidad en el primer clic tras un arranque en frío
- Las filas del informe de Ecos siempre muestran la palabra, con una descripción emergente de texto completo al pasar el puntero o al enfocar con el teclado

## [0.12.0] - 2026-10-17

### Added
- Sistema de Plugins: instala, activa y gestiona plugins desde Configuración, con filtros, añadir, eliminar, reinstalar, borrar datos y estado por Plugin
- Aprobación de permisos con hashes de archivo fijados, un paso de revisión para archivos modificados y un modo de desarrollo con recargas vigiladas
- Aportaciones de Plugins en comandos, páginas, entradas de la barra lateral, filas de Configuración, botones de la barra de herramientas y menús de elemento
- API de Plugins que abarca lecturas y escrituras de la Biblioteca, acceso y resaltados del editor enfocado, almacenamiento, navegación, notificaciones, red, secretos, portapapeles e idioma
- Kit de componentes de la interfaz remota renderizada por el anfitrión, además de Frames en sandbox con tokens de tema en vivo y un aviso de interfaz personalizada
- Plugin integrado Ecos para encontrar palabras y frases repetidas, con una página de informe, resaltados en el editor y navegación al eco siguiente y anterior
- Ejecución de Plugins en Android mediante un motor QuickJS con límite de memoria, opcional por plugin a través de las plataformas de su manifiesto
- Botones de alternancia para los controles de Plugins en la barra de herramientas, con estado pulsado que refleja la disponibilidad del plugin
- Plantilla de Plugin, guía de creación y Skill de agente para crear plugins externos

### Changed
- Los plugins integrados ahora empiezan desactivados y con permisos previamente concedidos, con Ecos desactivado por defecto
- Las filas de Plugins en Configuración muestran distintivos de cabecera, un interruptor de activación, nombres localizados y un acordeón de permisos
- Las entradas de Plugins en la barra lateral se colocan después de los destinos principales, mientras Métricas y Configuración siguen fijados abajo
- Las vistas se actualizan cuando las filas cambian por escrituras de plugins, importaciones o restauraciones de versiones

### Fixed
- Android mantiene la aplicación viva y la reinicia cuando muere el renderizador del WebView
- El inicio de sesión en Linux ya no muestra un icono duplicado en la bandeja
- Revelar una fila en Configuración espera a que se monte el control de la fila del Plugin antes de mover el foco
- Ecos mantiene su informe dentro de los límites de la interfaz remota y sigue respondiendo en libros grandes
- Las escrituras de Plugins vacían primero los editores abiertos y se rechazan limpiamente cuando falla un guardado

## [0.11.0] - 2026-10-09

### Added
- La Vista previa del enlace muestra adónde lleva un enlace sin seguirlo al pasar el puntero o dejar el cursor sobre un enlace durante 500 ms
- La Vista previa del enlace incluye destinos de nota, capítulo, encabezado, libro y dirección web con los detalles relevantes
- El clic derecho o la pulsación larga sobre un enlace en un nodo de texto abre Editar Enlace
- Los lectores de pantalla oyen los destinos de los enlaces mediante una región activa de tipo polite

### Changed
- La Vista previa del enlace carga los fragmentos a demanda y los guarda en caché hasta un cambio, un cambio de biblioteca o 30 segundos
- La Vista previa del enlace oculta el icono de tipo para notas, capítulos, encabezados y libros
- Editar Enlace muestra el destino actual

### Fixed
- Escribir [[ crea una marca de enlace estándar en lugar de un nodo atómico, lo que corrige la selección de texto, la edición con clic derecho y las vistas previas
- Elegir una sugerencia de enlace consume el ]] cerrado automáticamente y escribir ] cierra la lista de sugerencias
- Las sugerencias de enlace leen las notas y los libros al abrirse, así aparecen los elementos creados después de abrir el editor
- Cerrar un diálogo restaura el foco sin desplazar el editor lejos del enlace
- Un clic que termina una selección por arrastre dentro de un enlace ya no lo sigue
- Los iconos de la Vista previa del enlace se alinean con la primera línea
- La lista de sugerencias de enlace se desplaza para mantener visible la opción activa

## [0.10.4] - 2026-10-08

### Added
- Opciones de tamaño de la Barra de dictado (Oculta, Compacta, Completa) y un indicador para contraerla hasta el micrófono; Completa sigue siendo el valor predeterminado
- Navegación con flechas del teclado entre widgets y paneles, incluido el movimiento por posición, las salidas por los bordes, la entrada de paneles con F6 y un marco de foco de panel visible
- Tiradores de redimensionado operables por teclado en todos los paneles, con redimensionado por flechas, ancho anunciado y arrastre táctil

### Changed
- Las listas y las cuadrículas de tarjetas son ahora una sola parada de Tab, con los botones de fila o tarjeta alcanzables con las flechas y las salidas por los bordes
- Los tiradores de redimensionado de panel ahora actualizan el ancho del panel en vivo durante el arrastre con el puntero, sin volver a renderizar toda la pantalla
- La navegación con flechas en listas y galerías grandes ahora evita comprobaciones completas de filas o tarjetas, manteniendo el movimiento ágil

### Fixed
- El botón de ajustes de la barra de dictado ahora abre la sección Dictado en lugar de aterrizar en la sección Editor
- El anillo de foco del panel ahora se oculta al escribir, usar el puntero o pulsar Escape, hasta que el foco de teclado se mueve de nuevo
- Escape en un tirador de redimensionado enfocado ahora devuelve el foco al control anterior en lugar de propagarse
- Los grupos por fecha de la lista de Notas ahora se ordenan por edición más reciente primero
- La navegación con flechas mantiene los encabezados del esquema dentro de la fila de su Capítulo, permite que Izquierda salga de una sección de Configuración abierta y aterriza en el texto del editor en lugar del control de tamaño de fuente

## [0.10.3] - 2026-10-03

### Changed
- Mejora el rendimiento de apertura del diálogo de la paleta de comandos evitando trabajo no relacionado
- Mejora el rendimiento del reordenado con teclado en Capítulos, Notas y la configuración de la barra de herramientas aparcando las selecciones de texto durante los arrastres

### Fixed
- Mantiene visibles los destinos de búsqueda de Configuración en la paleta de comandos y estable la barra de desplazamiento del esquema al cargarse la lista de Copias de seguridad
- Evita que la animación del esquema de Configuración parpadee o salte durante el desplazamiento rápido y los cambios de destino a mitad de camino
- Hace que los botones de fila de Notas, como Editar, Duplicar y Eliminar, respondan a Intro y Espacio en lugar de abrir la nota
- Hace accesibles por teclado las filas de la vista de árbol de Notas, con Intro para abrir, Mayús+F10 para el menú de elemento y retorno del foco tras cambiar el nombre
- Corrige el dictado para que «nuevo elemento» cree un elemento de lista y «borra eso» elimine los saltos de línea nuevos sin borrar la frase de encima
- Evita que la tecla que cierra el último diálogo dispare inmediatamente un Comando

## [0.10.2] - 2026-10-02

### Added
- Diálogo de Novedades abierto desde el número de la versión en la barra lateral y en Configuración → Acerca de, con las versiones publicadas más recientes marcadas como Nuevo y un enlace de descarga cuando está disponible
- Comando `global.openReleaseNotes` para la paleta de comandos y la voz

### Changed
- Las comprobaciones de actualización ahora usan las Releases publicadas en GitHub en lugar de etiquetas, así la insignia Nuevo aparece solo cuando se publican todas las compilaciones de cada plataforma
- El esquema de Configuración ahora se anima con suavidad entre secciones en lugar de saltar

### Fixed
- Restaura las ventanas de la bandeja en la primera activación en Linux, incluidas las activaciones ocultas, minimizadas y de arranque en frío antes de que exista la ventana principal

## [0.10.1] - 2026-10-02

### Added
- Esquema de secciones con búsqueda en Configuración y un menú de secciones compacto en paneles estrechos

### Changed
- Unifica las secciones de Configuración en un único ritmo de tarjeta, título y separador
- Mejora el rendimiento de renderizado del esquema de Configuración al desplazarse

### Fixed
- Ancla los menús de texto e imagen a su elemento de activación
- Mantiene la aplicación inerte durante todo el Tutorial cuando empieza desde un modal que se cierra
- Hace que cada inserción, edición y eliminación de nota al pie sea su propio paso de deshacer
- Añade controles de expansión accesibles a las secciones del esquema de Configuración
- Los atajos del editor y las teclas de borrado ahora usan la posición actual del cursor inmediatamente después de moverlo
- Pulsar Escape justo después de extender una selección ahora conserva el último paso de la selección

## [0.10.0] - 2026-10-01

### Added
- Paleta de comandos accesible con F1 / Mod+Mayús+P, con búsqueda clasificada entre comandos, libros, capítulos, notas, lienzos, filas de configuración, páginas anidadas y elecciones recientes
- Dictado sin conexión en la web y en el escritorio de Linux con modelos en inglés y español, un control flotante en la página y gestión de modelos en Configuración → Dictado
- Intérprete de comandos de dictado con comandos de voz para formato y navegación, puntuación dictada, «borra eso», modificadores de números y mayúsculas, pulsar por nombre, teclas de foco y traspaso del dictado entre navegaciones
- Ajustes de Vocabulario de dictado y de Puntuación dictada por idioma para reemplazos de lo oído y lo escrito y el comportamiento de la puntuación
- Comandos de voz personalizados por idioma de dictado y un Editor de atajos para asignar atajos personalizados a cada Comando
- Selector de color accesible compartido en Configuración, el editor, el Lienzo y el Diseñador de Portada, con avisos de contraste y vista previa en vivo
- Acceso por teclado a la barra de la selección con Alt+F10
- Acciones de edición y eliminación de notas al pie en las listas de Notas al pie
- Submenú Estado del capítulo en los menús de elemento de Capítulo
- Reordenado con teclado en la lista de Notas
- Grabación de frases diciendo una frase una vez en los campos de comandos de voz
- Dictado en campos de texto sin formato, incluidos deshacer nativo y rechazo en contraseñas
- La ayuda de atajos muestra los Comandos de voz actuales mientras el Dictado está activo

### Changed
- Barra de título a todo el ancho en el Editor de libro y el editor de notas
- Se quitó la elevación al pasar el puntero en las tarjetas de Libro y Nota
- Se elevó la versión mínima de Android de 7.0/7.1 a 8.0 (API 26)
- Se restringió el acceso a la base de datos de la Biblioteca desde el webview y se reforzó la autorización de SQLite para ATTACH, VACUUM INTO y PRAGMAs
- Los ajustes de dictado ahora usan un único grupo de pestañas por idioma y un selector de idioma compacto

### Fixed
- Hace que la carga de archivos de base de datos de la Biblioteca, la importación y la restauración de copias de seguridad sean todo o nada
- Se recupera de una apertura fallida de la Biblioteca con un mensaje de error y Reintentar en lugar de una Biblioteca vacía, y detiene las eliminaciones en cascada en escritorio
- Mantiene estable la Posición de lectura mientras un Capítulo recién abierto termina de cargar imágenes y vistas de nodos
- Aplica el interlineado como un ajuste de bloque que ajusta el espaciado de las listas y escala el espaciado de párrafos tras Intro
- Corrige los enlaces a encabezados de Notas que nunca se desplazaban a su destino y avisa de los destinos ausentes
- Restaura los colores del botón Exportar en modo oscuro
- Rechaza cerrar un diálogo de exportación ocupado hasta que terminen la generación y el guardado
- Mantiene anunciadas las regiones activas de la aplicación mientras un modal está abierto
- Reconoce «pulsar tap» en español como Tab
- Muestra la barra de dictado en la página efímera
- Permite que Escape detenga el dictado en el Editor de libro
- Asigna por defecto a los Libros y Notas nuevos el idioma de la aplicación del autor o el idioma de su Libro
- Mejora la restauración del foco de teclado y el comportamiento del botón Intro y del botón predeterminado en diálogos, menús, barras de herramientas y formularios

## [0.9.0] - 2026-09-25

### Added
- Añade el Tutorial guiado en una Biblioteca del Tutorial en memoria, que se ofrece en el primer inicio y se puede relanzar desde Configuración o el teclado
- Añade selección y eliminación masiva de copias de seguridad en Configuración, con confirmación y notificación de fallos
- Añade menús de elemento accesibles por toque para notas, capítulos, tarjetas de la galería de Notas y nodos de Lienzo, con pulsación larga, clic derecho o el botón ⋯
- Añade el selector Conectar con… y puertos del nodo seleccionado para las conexiones del Lienzo por teclado y por toque
- Añade el botón Salir del modo enfocado en pantallas táctiles y compatibilidad con el botón Atrás de Android

### Changed
- Cambia el campo Carpeta de copias para mostrar el valor predeterminado efectivo, confirmar con Intro o al perder el foco, revertir con Escape y abrir el selector en la carpeta actual
- Cambia la aprobación de una carpeta de copias personalizada a confirmación nativa, guarda las aprobaciones fuera de las rutas escribibles por el webview y rechaza rutas relativas o con ~
- Cambia la columna Fecha de las copias para seguir el idioma de la aplicación y usar hora localizada de 12 horas
- Cambia el desplegable de estado del Libro para abrirse desde la píldora de estado en lugar del botón de esquina solo visible al pasar el puntero
- Cambia el arrastre de notas y capítulos en pantallas táctiles para iniciarse solo desde el agarre visible; la pulsación larga en el cuerpo de la fila abre el menú de elemento
- Cambia la eliminación de notas para pedir confirmación antes de quitar
- Cambia Añadir separador debajo por una acción siempre visible en los ajustes de la barra de herramientas
- Mantiene sin cambios las acciones al pasar el puntero en escritorio y muestra los controles específicos para toque solo en punteros gruesos

### Fixed
- Corrige la carpeta de copias personalizada para que funcione y se conserve entre inicios
- Corrige el anclaje de los menús de elemento a notas y capítulos visibles y su cambio correcto en clics derechos sucesivos
- Corrige los dibujos guardados del Lienzo que no se renderizaban en Chromium por un SVG de 0×0
- Corrige el desbordamiento de la barra de herramientas del editor para medir la maquetación real y dejar de desplazarse antes de tiempo
- Corrige las recargas de rutas web para que las rutas anidadas ya no abran una página en blanco
- Corrige las tarjetas del Tutorial para que enfoquen el botón Siguiente, de modo que Intro o Espacio avancen por los pasos

## [0.8.1] - 2026-09-16

### Changed
- Sin cambios visibles para el usuario

## [0.8.0] - 2026-09-16

### Added
- Sincronización de Lienzos como elemento sincronizado, con su propio alcance de sincronización y revisión de eliminaciones
- Diálogo de ayuda que lista los atajos de teclado vinculados en la pantalla actual, agrupados por área

### Changed
- La sincronización manual ahora usa por defecto el alcance del editor actual
- Las marcas de tiempo de Última edición de los Libros ahora cambian solo con ediciones de contenido o de título, no con cambios de fijado, orden o estado
- Las etiquetas de la interfaz ahora coinciden con el glosario del dominio tanto en inglés como en español

### Fixed
- En Android, borrar al principio de un elemento de lista de tareas ahora funciona con el teclado en pantalla
- Las ediciones pendientes de notas y libros se guardan al desmontar, los guardados fallidos se reintentan y el Estado de guardado muestra «No guardado» en lugar de perder los cambios
- Las Copias de seguridad ahora incluyen Lienzos, y restaurar una copia solo reemplaza los Lienzos cuando la copia los contiene
- Los avisos de Reinicio, Restauración y fallo de restauración ahora describen con precisión qué se conserva, se reemplaza o se puede recuperar

## [0.7.1] - 2026-09-14

### Added
- El registro de sincronización ahora muestra las escrituras rechazadas

### Fixed
- La sincronización ya no vuelve a crear notas o libros eliminados en otro dispositivo

## [0.7.0] - 2026-09-12

### Added
- La sincronización automática, activada por defecto, se ejecuta al iniciar y 30 segundos después de la última edición local cuando hay sesión iniciada y conexión

### Changed
- La sincronización ahora aplica automáticamente los cambios locales o remotos unilaterales y solo pregunta cuando ambos lados cambiaron
- La sincronización automática pospone los conflictos y continúa más allá de las revisiones de eliminaciones pendientes
- Abrir un libro ya no cuenta como una edición local para la sincronización

### Fixed
- Mantiene viva la sesión de sincronización mientras la aplicación se ejecuta, refrescándola periódicamente y al reconectar en lugar de forzar un nuevo inicio de sesión
- Refresca el libro, capítulo o nota abierto en su sitio tras recibir cambios de la sincronización, en lugar de mostrar contenido obsoleto o volver a montar el editor

## [0.6.2] - 2026-09-12

### Fixed
- Evita que la insignia de guardado del editor vuelva a inactiva demasiado pronto al guardar de nuevo antes de que se dispare el temporizador de reinicio anterior

## [0.6.1] - 2026-09-12

### Fixed
- limpia el reinicio pendiente del estado de guardado al desmontar, para que un temporizador obsoleto ya no actualice el estado de un editor desmontado

## [0.6.0] - 2026-09-12

### Changed
- Versión de mantenimiento.

## [0.5.3] - 2026-09-12

### Changed
- detiene el trabajo por pulsación que escala con la longitud del capítulo (#160)

## [0.5.2] - 2026-09-07

### Fixed
- sale mediante finish() de la actividad en lugar de process::exit (#155) (#158)
- protege la copia de seguridad al cerrar con un intervalo de 6 horas (#154) (#157)
- mantiene la copia diaria fuera de la ruta de inicio y deja de copiar el volcado (#156)
- detiene el bloqueo por falta de memoria al iniciar y el cierre de la aplicación con el botón Atrás (#152)

## [0.5.1] - 2026-09-07

### Added
- gestiona las URL maibuk:// del sistema operativo (#147)

### Fixed
- mantiene la sincronización móvil ágil y serializada (#148)

## [0.5.0] - 2026-08-13

### Added
- Añade la aplicación para Android con compilaciones APK firmadas y compatibilidad específica para móvil con áreas seguras de página completa, manejo del botón Atrás del hardware, volcado de datos en segundo plano, controles de capas de portada y manejo de archivos e imágenes
- Añade el archivado de libros como cuarto estado, con filtro por estado en la galería
- Añade filtros de galería y búsqueda persistentes entre visitas para notas, lienzos y libros
- Añade el filtro de exclusión de etiquetas en las notas
- Añade controles accesibles de color de texto y de fondo del lienzo, con predefinidos comprobados por contraste y colores personalizados
- Añade nodos de texto más grandes en el lienzo que se seleccionan al crearlos

### Changed
- Reemplaza el botón de archivar de la tarjeta del libro por un desplegable de estado para fijar borrador, en progreso, completado o archivado directamente desde la galería, con los libros desarchivados volviendo a borrador
- Oculta los ajustes exclusivos de escritorio y las pistas de atajos de teclado en móvil y Android
- Mejora las maquetaciones adaptativas y el manejo de áreas seguras en móvil y Android, incluidos los editores de página completa y las barras inferiores

### Fixed
- Corrige el solapamiento con la barra del sistema de Android, el desplazamiento duplicado de la página y las acciones duplicadas de Atrás en móvil
- Corrige el desbordamiento del panel de filtros de notas y mantiene el botón de filtros junto al cuadro de búsqueda en paneles estrechos
- Mejora el manejo del portapapeles de imágenes y de las URI de contenido en Android, el redimensionado táctil y los objetivos táctiles de la barra de herramientas del lienzo

## [0.4.20] - 2026-07-18

### Added
- Importación de archivos Markdown por arrastrar y soltar para crear notas y capítulos, con indicadores de inserción posicional y respuesta en tiempo real
- Botón de alineación justificada en la barra de herramientas del editor con el atajo Ctrl+Mayús+J

### Fixed
- Los títulos largos de capítulo se desbordaban horizontalmente y ocultaban los botones de acción
- Indicadores duplicados al soltar archivos en el editor
- El reordenado por arrastrar y soltar no funcionaba tras vaciar la lista de capítulos
- Los botones de acción del capítulo encogían los títulos al superponerse

## [0.4.19] - 2026-07-17

### Added
- Cierre automático opcional de pares de corchetes y comillas en el editor
- Autocompletado de emoji al escribir dos puntos en el editor
- Diálogo de Símbolos (Ctrl+Mayús+O) con búsqueda, recientes y descripciones emergentes para insertar Unicode y emoji
- Búsqueda manual en el diccionario (Ctrl+Mayús+D), con un aviso cuando no hay texto seleccionado

### Fixed
- Confirma la eliminación del lienzo con un diálogo dentro de la aplicación en lugar de un aviso del navegador poco fiable
- La ayuda de atajos de la barra de herramientas del editor ahora lista correctamente los atajos disponibles al abrirse

## [0.4.18] - 2026-07-16

### Added
- Editor de borrador solo de sesión con almacenamiento en memoria, accesible desde la navegación y con el atajo `g e`, con acciones de vaciar y crear nota

### Fixed
- El cursor saltaba en el editor cuando los ecos de contenido obsoleto entraban en conflicto con la escritura reciente

## [0.4.17] - 2026-07-15

### Added
- Navegación por teclado en todas las superficies principales de la aplicación, incluidos diálogos, menús, barras laterales y controles del editor
- Modos de transformación de texto: espejo horizontal, boca abajo, texto al revés y leetspeak, conservando el formato del texto

### Changed
- Se reemplazó la biblioteca de componentes Headless UI por React Aria para mejorar la accesibilidad y la coherencia

### Fixed
- Escribir después de un fragmento de código en línea ahora sale del código correctamente sin insertar un espacio extra
- Las selecciones de varias líneas alternadas como bloque de código ahora se fusionan en un solo bloque en lugar de bloques separados
- El cursor del editor ya no salta al inicio del documento cuando el contenido se guarda con IDs de encabezado asignados automáticamente
- Se eliminó una sombra de borde de página incorrecta que aparecía en algunas maquetaciones del editor
- La navegación de la barra lateral ahora se activa con un solo clic en lugar de requerir doble clic
- El esquema del capítulo aparece directamente debajo de su capítulo activo y admite navegación con las flechas
- Se eliminaron atributos ARIA no válidos y se mejoró la gestión del foco para la tecnología de asistencia

## [0.4.16] - 2026-07-12

### Added
- Las descripciones emergentes de la barra de herramientas ahora muestran los atajos de formato y las pistas de sintaxis Markdown, con las pistas resaltadas con estilo de código

### Changed
- La barra de herramientas del editor ahora es personalizable: los grupos se pueden reordenar por arrastrar y soltar o con el teclado, y un diálogo de ajustes te permite elegir qué controles mostrar. La maquetación de la barra de herramientas es adaptativa, contrae automáticamente los controles en un menú de desbordamiento y ajusta los grupos expandidos

## [0.4.15] - 2026-07-06

### Added
- Descripciones emergentes personalizadas con fichas de teclas de atajo en el editor, el lienzo, las notas y los ajustes
- Persistencia del estado de la ventana de escritorio (tamaño, posición y maximizada) entre sesiones
- El icono de la bandeja ahora indica el estado de sincronización en curso

### Changed
- El diálogo de ayuda ahora muestra los atajos de teclado como fichas de teclas, en coherencia con las descripciones emergentes

### Fixed
- Las fichas de atajos secuenciales ya no tienen un separador de flecha (p. ej., «G N» se muestra como dos teclas adyacentes)

## [0.4.14] - 2026-06-28

### Added
- Añade un diálogo de ayuda de atajos de teclado, accesible con un botón nuevo en la barra de herramientas del editor, que lista todos los atajos activos de la ruta actual
- Añade un espacio de lienzo infinito (mapas mentales) con nodos de texto enriquecido, dibujo a mano alzada, conexiones entre nodos y un panel de herramientas plegable
- Añade un control de margen de página del editor para ajustar el ancho del área escribible, con modos de entrada simple y personalizado
- Añade selección de lenguaje para bloques de código en línea; el resaltado de sintaxis ahora está desactivado por defecto hasta que se elige un lenguaje

### Changed
- Actualiza las fichas de etiquetas para usar colores dinámicos y bordes sutiles, con una distinción visual más clara

## [0.4.13] - 2026-06-24

### Added
- Documenta el selector de idioma del corrector ortográfico en el editor
- Desplegable de orden en la galería de notas (por fecha o título; preferencia guardada)
- Ancho de contenido del editor ajustable con predefinidos, control deslizante y bordes laterales
- Creación de reglas de Limpieza al pegar a partir del texto seleccionado en la vista de código HTML

### Changed
- Las notas ahora usan una marca de tiempo de modificación de contenido independiente; las acciones de organización, como etiquetar o fijar, ya no actualizan la fecha de modificación de la nota
- Los valores de las reglas de Limpieza al pegar se editan en un área de texto que crece automáticamente, y se quitó la descripción emergente de vista previa del destino para evitar desbordamientos

## [0.4.12] - 2026-06-22

### Added
- Resaltado de sintaxis para bloques de código en el editor con lowlight
- Se rehizo la maquetación de las notas

### Changed
- Se mejoró el comportamiento del pegado del editor y de la escritura en Markdown

### Fixed
- El ciclo del tema del sistema ahora respeta el esquema de color del sistema operativo

> Las versiones anteriores están en la página de [GitHub Releases](https://github.com/M4ss1ck/maibuk/releases).
