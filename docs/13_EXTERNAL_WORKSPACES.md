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

# No adquirir nuevos privilegios (fase 4A)

Compose habilita `security_opt: [no-new-privileges:true]` para OpenCode. Esto
bloquea la adquisición de privilegios mediante setuid, setgid y file capabilities
al ejecutar programas. No equivale a `cap_drop: ALL` ni vuelve read-only el root
filesystem, que en fase 4A sigue RW. En fase 4A no se añaden `cap_drop`, `tmpfs`, `pids_limit`, `init`,
`stop_grace_period` ni cambios de red.

Se conservan `/workspace` RO, HOME externo RW, agentes RO y `opencode.json` RO,
la imagen fijada por digest y el usuario 1000:1000. `lab-open` no necesita cambios:
su recreación mediante Compose conserva `security_opt`. La opción se aplicará en
una futura recreación autorizada; validar esta fase no arranca ni recrea
contenedores, ni ejecuta OpenCode u Ollama reales.

# Eliminar capabilities Linux (fase 4B)

Compose añade `cap_drop: [ALL]`: elimina todas las capabilities Linux del
contenedor y no devuelve ninguna (`cap_add` está ausente). Se mantiene
`security_opt: [no-new-privileges:true]` y el usuario 1000:1000.

Se espera que fallen las operaciones que requieran esas capabilities, como crear
raw sockets, cambiar arbitrariamente UID/GID o hacer `chown` arbitrario. Esto no
impide operaciones permitidas al usuario sin capabilities. Los flujos previstos
de LAB-IA no dependen de ellas: el contenedor lee el workspace y escribe su HOME;
Proposal y Apply trabajan desde el backend host. No se ha probado OpenCode real
ni el fallo de estas operaciones privilegiadas en un contenedor.

En fase 4B los mounts y la red no cambian; el root filesystem sigue RW. No se añaden
`tmpfs`, `pids_limit`, `init` ni `stop_grace_period`. `lab-open` conserva
`cap_drop` al recrear mediante Compose y no necesita cambios. La configuración
se aplicará en una futura recreación autorizada; esta validación no arranca ni
recrea contenedores ni ejecuta modelos.

# Root filesystem de solo lectura y temporales (fase 4C)

Compose añade `read_only: true` y un único tmpfs:
`/tmp:rw,nosuid,nodev,exec,size=256m,mode=1777`. En la próxima recreación,
el root filesystem será RO: `/usr`, `/app`, `/root` y `/var` quedarán sin
escritura, salvo mounts especiales propios de Docker. No se añade ningún mount
RW para `/run` ni `/var/tmp`.

El bind mount externo de `/home/adolf` sigue RW; `/workspace`, agentes y
`opencode.json` siguen RO. `/tmp` será efímero, sin volumen persistente, y su
contenido no se conservará al recrear el contenedor. Mantiene `exec`
temporalmente por compatibilidad con Bun/OpenTUI y librerías nativas `.so`;
no se configura `noexec`. El tmpfs tiene un límite de 256 MiB, consume memoria
y puede usar swap; no reserva toda esa memoria de antemano.

Se mantienen NNP, `cap_drop: [ALL]`, ausencia de `cap_add`, usuario e imagen
fijada por digest. La fase 4C no incluye límites de PID, `init`, cambios de parada
ni de red. `lab-open` ya aplica las opciones mediante Compose al recrear y no
necesita cambios; conserva su comprobación de `/workspace` RO.

La validación es estática y con mocks: no recrea contenedores ni ejecuta modelos.
No se ha comprobado que OpenCode funcione con root filesystem RO. El contenedor
existente no cambia hasta una futura recreación autorizada.

# Procesos y cierre (fase 4D)

Compose añade `init: true`, `pids_limit: 256` y `stop_grace_period: 30s`.
El init ayuda a recoger procesos hijos terminados y reenviar señales. El límite
de PID restringe procesos/hilos del contenedor: 256 es un valor inicial pendiente
de validar con la carga real.

La gracia de 30 segundos da tiempo para un cierre limpio antes de forzar la
terminación. El Compose anterior no declaraba una gracia de 1 segundo; no se
ha comprobado ese valor previo. `runLabOpen` en `server/index.js` impone un
timeout global de 120 segundos a la activación: los 30 segundos caben y dejan
hasta 90 segundos para las demás operaciones. El script `lab-open` no impone un
timeout menor ni necesita cambios. Esto no garantiza que toda activación termine
en plazo, por ejemplo si Docker o la descarga de imagen tardan más.

Esta fase no toca red, DNS ni `extra_hosts`. Se conservan NNP, `cap_drop: [ALL]`,
rootfs RO, tmpfs de `/tmp` con `exec`, mounts, imagen y usuario. Las opciones
se aplicarán en una futura recreación autorizada. La validación estática y con
mocks no demuestra compatibilidad real ni un cierre correcto de OpenCode;
no se ha ejecutado el contenedor real.

# Preparación offline sin aislamiento de red (fase 5A)

Para OpenCode 1.17.18, Compose conserva `HOME=/home/adolf` y añade
`OPENCODE_DISABLE_AUTOUPDATE=true`, `OPENCODE_DISABLE_MODELS_FETCH=true` y
`OPENCODE_DISABLE_DEFAULT_PLUGINS=true`. La configuración global montada desde
`docker/opencode.json` añade `autoupdate: false`, `share: "disabled"` y
`enabled_providers: ["ollama"]`. Se deshabilitan las comprobaciones/actualizaciones
automáticas, la descarga inicial y el refresco automático del catálogo models.dev,
el uso compartido de sesiones y la selección de providers distintos de Ollama.
No se elimina código de providers empaquetados ni se tocan credenciales.

Se deshabilitan los default plugins tras revisar su función en esa versión:
son integraciones de autenticación de otros providers; Ollama usa el SDK
`@ai-sdk/openai-compatible` empaquetado y no depende de ellas. Workspace summary
usa el reviewer con herramientas denegadas y `--pure`; los hooks sin plugins
devuelven su salida sin alteraciones. Esta conclusión proviene del código, no
de una prueba de OpenCode real. No se añaden plugins externos.

LSP y formatters siguen ausentes de la configuración (deshabilitados por defecto
en esta versión); no se habilitan instaladores de herramientas. Compose no
configura `OTEL_EXPORTER_OTLP_ENDPOINT`; no se añade un flag genérico de
telemetría. El modelo sigue siendo `ollama/qwen3:8b` con baseURL
`http://host.docker.internal:11434/v1`.

Esta fase reduce tráfico externo automático, pero NO bloquea Internet: OpenCode
conserva acceso de red general. No cambian networks, DNS, `extra_hosts`, puertos
ni el hardening previo. La preparación busca facilitar una prueba offline
posterior. Una instalación/reparación futura de dependencias puede requerir
Internet; comandos explícitos de actualización/refresco o nuevas integraciones
también podrían intentar conexiones. Estos ajustes no son una política de egress
ni impiden que otras fuentes de configuración introduzcan opciones distintas.

`lab-open` no necesita cambios: Compose aplica las variables en una futura
recreación autorizada. No se recrea el contenedor ni se ejecutan modelos durante
esta validación. Las nuevas variables no alteran un contenedor ya existente.

Referencias del tag exacto: [flags](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/core/src/flag/flag.ts),
[configuración](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/core/src/v1/config/config.ts),
[plugins](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/plugin/index.ts)
y [provider empaquetado](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/provider/provider.ts).
