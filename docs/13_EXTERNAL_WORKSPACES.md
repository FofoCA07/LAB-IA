# Propósito

LAB-IA puede trabajar sobre proyectos externos almacenados en WSL o Windows sin copiarlos dentro del laboratorio. El proyecto conserva su ubicación y se utiliza directamente como workspace de OpenCode.

# Cómo funciona

LAB-IA mantiene sus agentes y configuración dentro de `/home/adolf/LAB-IA`. El proyecto externo se monta como `/workspace:ro` dentro del contenedor OpenCode principal. OpenCode puede leerlo y analizarlo, pero no modificar sus archivos.

La variable `LAB_WORKSPACE` controla qué proyecto se monta. Si no se define o está vacía, Compose usa `../` desde el directorio `docker`, manteniendo LAB-IA como workspace predeterminado.

`scripts/lab-open` automatiza la selección y verificación del workspace. Los ejemplos usan el comando `lab-open`, que requiere que el script esté disponible en `PATH`. También puede invocarse directamente como `/home/adolf/LAB-IA/scripts/lab-open`.

# Proyectos en WSL

Se usa la ruta Linux normal del proyecto:

```bash
lab-open /home/adolf/proyectos/MiProyecto
```

La ruta debe existir y corresponder a un directorio.

# Proyectos en Windows

Ahora se puede abrir directamente un proyecto con su ruta absoluta de Windows:

```bash
lab-open 'C:\Users\adolf\Documents\MiProyecto'
```

`lab-open` convierte automáticamente esa ruta a su equivalente en WSL:

```text
/mnt/c/Users/adolf/Documents/MiProyecto
```

También sigue siendo válida la forma manual con `/mnt/c/...`:

```bash
lab-open /mnt/c/Users/adolf/Documents/MiProyecto
```

El launcher acepta rutas absolutas con letras de unidad como `C:` o `D:` seguidas de `\` o `/`. Convierte la letra a minúscula y sustituye los backslashes (`\`) por slashes (`/`): por ejemplo, `D:\Proyectos\MiApp` se convierte en `/mnt/d/Proyectos/MiApp`. La unidad debe estar montada en su ubicación habitual bajo `/mnt`.

Las rutas Windows relativas, como `C:MiProyecto` o `Proyectos\MiApp`, se rechazan. Usa comillas simples para conservar los backslashes en Bash; las rutas con espacios deben ir entre comillas.

# Selector de workspaces recientes

Para elegir un workspace del historial, ejecuta el comando sin argumentos:

```bash
lab-open
```

El selector lee `recent-workspaces` en el directorio privado externo de LAB-IA y muestra únicamente rutas que siguen existiendo y son directorios. Muestra como máximo 10 workspaces, numerados desde 1, y añade como última opción «Escribir otra ruta»:

```text
Workspaces recientes:
1) /mnt/c/Users/adolf/Documents/FacturacionApp
2) /home/adolf/proyectos/MiAPI
3) Escribir otra ruta

Selecciona una opción:
```

Escribe el número del workspace que quieres abrir. El selector valida la selección y vuelve a solicitarla si el número no es válido. Si eliges «Escribir otra ruta», solicita la ruta del proyecto. Si no existe el historial o no contiene ningún directorio que siga existiendo, solicita directamente una ruta.

Una ruta escrita manualmente pasa por la misma conversión y validación normal de `lab-open`: admite rutas WSL y rutas absolutas de Windows, y debe corresponder a un directorio existente. Al escribirla en el selector, introduce los espacios y backslashes directamente, sin comillas de Bash.

# Historial de workspaces

El historial se actualiza solo después de abrir correctamente el workspace, verificar el estado de OpenCode y el montaje, y mostrar el contenido de `/workspace`. Guarda primero la ruta real del workspace más reciente, evita duplicados y conserva como máximo 10 entradas.

Se guarda en `<directorio de estado>/recent-workspaces`, fuera del repositorio. Véase la configuración del runtime privado al final de este documento.

# Qué hace lab-open

- Sin argumentos, permite elegir un workspace reciente o escribir otra ruta; con una ruta, abre directamente ese proyecto. Si recibe más de un argumento, muestra el uso y termina con error.
- Valida que la ruta exista y sea un directorio.
- Resuelve la ruta absoluta real, incluidos los enlaces simbólicos del directorio.
- Localiza LAB-IA automáticamente a partir de la ubicación del propio script.
- Usa `docker compose` desde el directorio `docker` de LAB-IA.
- Define `LAB_WORKSPACE` y recrea únicamente el servicio `opencode`, sin recrear Ollama:

  ```bash
  LAB_WORKSPACE="<ruta>" docker compose up -d --force-recreate opencode
  ```

- Monta el proyecto como `/workspace:ro`.
- Verifica que OpenCode esté en estado `running`.
- Comprueba mediante Docker inspect que el workspace montado coincida con la ruta real solicitada y que `.RW` sea exactamente `false`. Si falta metadata o aparece RW, aborta antes de listar el proyecto o actualizar el historial.
- Informa el workspace solicitado, el resuelto, el montado y el estado de OpenCode.
- Muestra el contenido de `/workspace` mediante `ls -la`, un comando de solo lectura.

Si Docker o Compose falla, el script se detiene y muestra el error.

# Qué no hace

- No copia proyectos ni mueve archivos.
- No ejecuta comandos de eliminación de contenedores, imágenes, redes, volúmenes ni datos. La recreación solicitada de `opencode` sí reemplaza su contenedor anterior.
- No ejecuta `docker compose down`.
- No usa `sudo`.
- No modifica Ollama.

# Rutas con espacios

Las rutas con espacios deben ir entre comillas para enviarlas como un único argumento:

```bash
lab-open "/mnt/c/Users/adolf/Documents/Mi Proyecto"
```

# Flujo recomendado

1. Ejecutar `lab-open` sin argumentos y elegir un workspace del historial o escribir otra ruta.
2. Como alternativa, proporcionar una ruta directamente: `lab-open /home/adolf/proyectos/MiProyecto`. Si vive en Windows, usar su ruta absoluta entre comillas simples o su equivalente en `/mnt/...`.
3. Comprobar que el workspace montado sea el esperado y OpenCode esté en estado `running`.
4. Abrir OpenCode para leer y analizar `/workspace`; las escrituras sobre el proyecto están bloqueadas por el filesystem.

# Consideraciones

- Los proyectos intensivos en Docker/Linux suelen rendir mejor dentro del sistema de archivos de WSL.
- Los proyectos que deban permanecer en Windows pueden abrirse mediante `/mnt/c/...`.
- No es necesario mover un proyecto de Windows a WSL solo por usar LAB-IA.
- Usar Git para revisar el estado y conservar una referencia recuperable antes de cambios importantes.

# Ejemplos rápidos

WSL:

```bash
lab-open /home/adolf/proyectos/MiAPI
```

Windows con ruta `C:\...`:

```bash
lab-open 'C:\Users\adolf\Documents\FacturacionApp'
```

Windows usando `/mnt/c/...`:

```bash
lab-open /mnt/c/Users/adolf/Documents/FacturacionApp
```

Windows con espacios:

```bash
lab-open 'C:\Users\adolf\Documents\Proyecto Java'
```

# Estado actual

Según las pruebas reportadas por el usuario, el soporte ya fue probado con:

- Workspace externo en WSL.
- Workspace externo en Windows.
- Montaje correcto como `/workspace`.
- OpenCode en estado `running`.

# Mejoras futuras

Quedan pendientes:

- Añadir mejoras adicionales al selector interactivo.
- Evaluar una posible integración futura con una interfaz web.

# Runtime privado externo (fase 2)

Backend y `scripts/lab-open` resuelven el mismo directorio privado:

1. `LAB_RUNTIME_DIR`, si está definido, es el override y debe ser una ruta
   absoluta externa. Un valor explícitamente vacío es un error.
2. Sin override, se utiliza `$XDG_STATE_HOME/lab-ia` si `XDG_STATE_HOME` no está
   vacío. Debe ser absoluto.
3. Si XDG no está definido o está vacío, se utiliza `$HOME/.local/state/lab-ia`.
   Para los defaults, `HOME` debe ser absoluto y un directorio existente.

Se canonicalizan symlinks y padres existentes mediante GNU `realpath -m`
(Linux/WSL). La ruta final nunca puede ser la raíz de LAB-IA ni un descendiente,
independientemente de si viene del override o del default. Validar no crea
archivos. `source` es `env` o `xdg-default`, solo interno; las rutas no se exponen
al frontend ni se utiliza una variable `VITE_*`.

El backend y el launcher deben recibir el mismo entorno. La activación desde el
backend lo hereda. Los scripts npm no necesitan cambios. El historial sigue en
`<directorio de estado>/recent-workspaces`: el launcher crea directorios nuevos
con 700 solo al escribir, y reemplaza el archivo mediante temporal 600 y rename
en el mismo directorio. No cambia permisos de directorios preexistentes.

El arranque normal del backend exige que `lab-ia.db` ya exista como archivo
regular no vacío, sin symlink, antes de abrir SQLite. No crea el directorio ni
una base vacía si falta el estado. Esto protege esta instalación migrada frente
a una ruta equivocada; no sustituye la validación SQLite. Una instalación nueva
requiere provisionar explícitamente una base inicial válida mediante un
procedimiento de instalación separado. No hay inicialización, copia desde
legacy ni migración automática. El esquema y el objeto SQLite compartido no
cambian.

El HOME de OpenCode es independiente: Compose monta
`${HOME}/.local/share/lab-ia-opencode/home` en `/home/adolf`. No debe incluir
`lab-ia.db` ni `recent-workspaces` del backend. Los mounts de agentes y
configuración siguen siendo read-only; el workspace es read-only y el HOME
externo permanece read-write. El estado privado de LAB-IA no se monta en OpenCode. Esta fase no recrea contenedores ni ejecuta modelos.

**`<LAB-IA>/runtime` ya no es fallback ni una dependencia del workspace.** El estado
privado se ha separado físicamente del repositorio. No borrar backups. Cualquier
copia legacy que se reintroduzca dentro del proyecto volvería a ser legible
aunque el mount sea RO.


# Workspace de solo lectura (fase 3)

El contenedor principal es un lector: sus herramientas `edit` o `bash` deben
fallar por filesystem read-only cuando intenten escribir en `/workspace`. Puede
seguir usando su HOME externo RW para estado, logs y cachés. No se cambia la
imagen, el usuario 1000:1000, la red ni el root filesystem.

Chat y los permisos read trabajan desde el backend. Workspace summary construye
su snapshot en el host y lo entrega a OpenCode con las herramientas de Reviewer
deshabilitadas. Proposal selecciona/lee archivos y genera el diff desde el
backend; no requiere escritura del contenedor. Apply sigue ejecutando Git desde
el backend host, con sus validaciones, índice temporal y single-use existentes:
el RO del contenedor no impide ese circuito autorizado.

Una autorización nunca debe elevar el contenedor lector a RW. La futura
escritura de agentes requerirá un ejecutor separado y temporal; no existe uno en
esta fase. Los locks y errores seguros de activación se mantienen. La comprobación
RO ocurre después de la recreación: si falla no registra éxito ni actualiza el
historial, pero no intenta revertir ni modificar mounts automáticamente.

Editar Compose no altera un contenedor ya existente. El nuevo mount se aplicará
en una recreación futura autorizada; las validaciones de esta fase no recrean
el contenedor ni prueban OpenCode real.
