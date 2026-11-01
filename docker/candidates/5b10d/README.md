# META A: candidato 5B.10D, no desplegado

Base auditada: `b0c4f9b`. Todos los archivos de esta fase viven aquí.
No sustituir archivos activos ni combinar este Compose con el productivo.
El Compose es completo: evita merges que conserven `default`, `extra_hosts`
o montajes anteriores. Los paths relativos dependen de esta ubicación.

## Estado y alcance

```text
OpenCode -- FRONT internal+isolated --> Gateway -- UPSTREAM convencional --> host.docker.internal:11434
Backend LAB-IA -------------------------- 127.0.0.1:11434 ------------------> Ollama existente
```

5B.10D fue estática; 5B.10E ensayó redes temporales con mock y las eliminó.
5B.10F solo auditó dependencias y ejecutó pruebas locales, sin recursos Docker.
No se creó HOME productivo; el HOME temporal de 5B.10F fue eliminado.
En 5B.10F no se ejecutó lab-open contra Docker real, gateway, reviewer ni inferencia.
Las pruebas del launcher usan interfaces y servidores simulados, sin sockets.
El proceso hijo de la prueba CLI recibe argumentos inválidos y termina antes
de importar el gateway o abrir listeners.

## Configuración efectiva prevista

- OpenCode: solo `front`, nombre productivo esperado `opencode`, sin extra_hosts.
- Gateway: `front` en `front0`; `upstream` en `upstream0`, prioridad de gateway 1.
- FRONT: bridge, internal, IPv4 activo, IPv6 deshabilitado, gateway mode isolated.
- UPSTREAM: bridge convencional, IPv4 activo, IPv6 deshabilitado.
- No se declaran `default`, Ollama, volúmenes Docker ni puertos publicados.
- Docker asignará subredes; comprobar solapamientos y opciones efectivas en ensayo.
- Descubrir la única IPv4 no loopback de `front0`; ausencia o ambigüedad aborta.
- Upstream constante `host.docker.internal:11434`; sin configuración por env/argv.
- Modelo y límites: los originales del módulo gateway, sin overrides.
- El provider candidato difiere del original únicamente en baseURL.
- Imágenes fijadas por los dos digests autorizados; `pull_policy: never`.
- Gateway: 256 MiB, 0,5 CPU, tmpfs privado 16 MiB; presupuestos no medidos.
- OpenCode conserva tmpfs 256 MiB con exec; no se añade límite de RAM nuevo.
- Ambos: UID/GID 1000:1000, rootfs RO, cap_drop ALL, no-new-privileges,
  pids_limit 256, init. Gateway solo monta dos archivos RO.
- Gateway se importa desde un bind RO con destino `.mjs`; sus bytes no cambian.
- Healthcheck comprueba HTTP 404 y ROUTE_DENIED en FRONT_IP; no llama a Ollama.
- SIGTERM/SIGINT permite drenaje hasta 25 s y después cierra conexiones activas;
  ese presupuesto de parada no altera el timeout normal de requests (105 s).

La validación de esquema con Compose 5.1.4 no demuestra enforcement del Engine,
binding efectivo, disponibilidad, consumo ni recuperación de 429 en producción.
El ensayo siguiente debe comprobar interfaces en arranque, reinicio y recreación.

## HOME auditado en 5B.10F; HOME productivo aún no creado

Ruta futura: `${HOME}/.local/share/lab-ia-opencode/home-meta-a` en el host,
montada en `/home/adolf`. Conservar el HOME anterior intacto para rollback.
No se creó esta ruta. Solo se preparó un HOME bajo /tmp y se eliminó al finalizar.

`HOME_INVENTORY.json` contiene el inventario reproducible: versiones esperadas
por el lock e instaladas, ubicaciones relativas, dependencias runtime, opcionales,
peers, ausencias opcionales, enlaces, cantidad de archivos y hashes de manifiesto.
`home-audit.py` recorre resolución ascendente de node_modules desde cada paquete,
resuelve ciclos mediante ubicaciones visitadas y conserva dependencias anidadas.
Nunca copia todo node_modules ni ejecuta npm, scripts de instalación o paquetes.

Resultados de la auditoría local:

- Dependencia directa: `@opencode-ai/plugin` 1.17.18.
- Cierre Linux/amd64: 27 paquetes; ninguna dependencia obligatoria faltante.
- SDK 1.17.18, zod 4.1.8, @ai-sdk/provider 3.0.8, effect 4.0.0-beta.83 y
  cross-spawn 7.0.6 confirmados. Las otras versiones están en el inventario.
- Peers opcionales ausentes: @opentui/core, @opentui/keymap, @opentui/solid.
  También faltan binarios opcionales de msgpackr-extract para otras plataformas.
  No son dependencias runtime obligatorias de este cierre Linux/amd64.
- Resolución local y en HOME copiado: 32 edges/subpaths PASS. `pure-rand` no
  exporta su raíz: se resolvieron sus subpaths literales usados por fast-check.
  `kubernetes-types` es solo tipos; está presente y versionado, no se importó.
- Siete paquetes contrastados con tarballs locales cuyo SHA-512 coincide con SRI
  del lock; todos los archivos regulares del tarball coinciden con los instalados.
  Veinte paquetes sin tarball local utilizable: versión/estructura y hashes
  locales comprobados, sin afirmar integridad criptográfica contra el registro.
  Archivos adicionales instalados, si existen, solo tienen hash local.
- No se encontraron symlinks necesarios en los paquetes seleccionados. El auditor
  rechaza enlaces externos y conserva solo enlaces relativos internos revisados.
- msgpackr-extract declara instalación, pero dispone del paquete de prebuilds
  Linux/x64, incluidos N-API glibc y musl. No se ejecutó su script ni se cargó
  código nativo. Compatibilidad efectiva en OpenCode/Bun sigue pendiente del mock.

El HOME temporal incluyó exclusivamente manifests técnicos, los 27 paquetes,
reviewer versionado y provider candidato. Sin auth, sesiones, historial, SQLite,
logs, claves ni npmrc. Se verificaron hashes tras copiar, UID 1000 y directorios
0700/archivos 0600. No se compartieron variables secretas ni se instaló nada.
La comprobación usa resolvers Node; no importa módulos ni activa inicialización.
Esto demuestra cierre y resolución, no ausencia universal de código malicioso.

Preparación posterior autorizada: repetir auditoría contra las fuentes locales,
comprobar que no cambiaron lock ni archivos, preparar el HOME de ensayo y ejecutar
reviewer con mock antes de promover. No copiar cachés, auth, estado ni paquetes
ajenos al grafo. Definir retención para el estado nuevo de OpenCode.
No se necesita paquete npm alguno para el gateway.

## Reviewer y backend

No se modifican backend ni agente. Workspace summary sigue aplicando exactamente:

```json
{"agent":{"reviewer":{"tools":{"*":false},"permission":"deny"}}}
```

La política inline deniega herramientas para ese flujo. El reviewer versionado
por sí solo conserva permisos de lectura; no atribuirle una denegación universal.
El gateway acepta algunas estructuras válidas de tools, pero rechaza schemas
prohibidos. No se garantiza compatibilidad de otros agentes ni todas las CLI.

Conservar OpenCode 110 s, execFile 120 s y gateway 105 s por request.
No introducir el deadline experimental de 240 s ni retries del backend.
El backend sigue ejecutando el contenedor `opencode`, usa el modelo del config
y conserva sus transportes directos a `127.0.0.1:11434`.

## Contrato cotidiano de lab-open corregido en 5B.10F

El backend invoca `spawn(labOpenPath, [workspacePath], {cwd: labRoot,
shell: false, stdio: 'ignore'})`, hereda el entorno y espera exit 0. El límite
es 120 s; cualquier otro código es fallo. No analiza stdout/stderr. La ruta
proviene del historial reciente validado por el backend y debe existir.

Se retiró `--apply-meta-a` y el requisito de una variable de aprobación nueva.
La llamada cotidiana acepta el único argumento existente y mantiene la selección
interactiva sin argumentos, limitada al historial. Las rutas se canonicalizan;
una ruta inexistente o fuera del historial se rechaza antes de invocar Docker.
Registrar un workspace nuevo pertenece a la operación administrativa separada.

El HOME esperado se deriva de HOME en la ruta dedicada indicada arriba; se
exporta para Compose sin exigir que el backend añada variables. No se crea.
Si LAB_OPENCODE_HOME ya está definido debe coincidir exactamente con esa ruta
canónica. Se preservan LAB_RUNTIME_DIR/XDG_STATE_HOME y el historial externo.

El script reconoce su ubicación candidata y la futura ubicación scripts/;
ambas apuntan al Compose candidato explícito del repositorio. Una promoción
posterior deberá conservar esa distribución o revisar y probar las rutas.
El archivo candidato es ejecutable; no se reemplazó el script activo.

Operación diaria: exige FRONT y UPSTREAM existentes, FRONT isolated, gateway
existente healthy en ambas redes y OpenCode existente, running, solo en FRONT,
sin extra_hosts ni puertos y workspace RO. Solo entonces recrea OpenCode usando
proyecto `docker`, `--no-deps --pull never --no-build`; verifica de nuevo el
montaje y topología y actualiza historial. No inicia gateway, crea infraestructura,
ejecuta cutover, toca Ollama ni limpia otras redes. Errores Docker se sanitizan.
La falta de infraestructura falla antes del up: su instalación es administrativa.

No se ejecutó contra Docker real. Trece pruebas con shim verifican el contrato,
allowlist, estado del gateway, redes, extra_hosts, puertos, RO, ausencia de provisión
y errores. Un futuro ensayo debe evaluar la activación con esa infraestructura
ya instalada. La compatibilidad de argumentos no es una autorización de promoción.

No ejecutar este script durante el ensayo mock: referencia deliberadamente
el proyecto/nombre productivos. Usar proyecto y nombres temporales exclusivos,
retirar container_name productivo, mounts sintéticos y sustitución del upstream
solo en una copia temporal del launcher. El launcher candidato sigue inmutable.

## Validaciones locales repetibles

Desde la raíz del repositorio:

```bash
node --test docker/candidates/5b10d/gateway-launcher.test.mjs
node --check docker/candidates/5b10d/gateway-launcher.mjs
bash -n docker/candidates/5b10d/lab-open
python3 docker/candidates/5b10d/validate-candidate.py
python3 docker/candidates/5b10d/lab-open.test.py
python3 docker/candidates/5b10d/home-audit.py --prepare-test --write-inventory
git diff --check
```

El validador invoca exclusivamente `docker compose config` con paths sintéticos
no creados, comprueba el resultado JSON efectivo y no lo imprime completo.
También compara archivos activos con Git, revisa baseURL, límites y whitespace
de todos los archivos candidatos no rastreados. No ejecuta `lab-open`.
En el sandbox de herramientas, la captura de subprocesos del test runner Node
falló; las pruebas pasaron fuera de esa restricción, con los mismos fakes.
Las pruebas usan Node nativo de WSL; el runtime oficial 22.23.4 se ensayó con mock en 5B.10E; el reviewer sigue
pendiente de un ensayo autorizado. El launcher exige esa versión al iniciar.

## Riesgos y siguiente aceptación

CONDITIONAL GO exclusivamente para diseñar/autorizar ensayo temporal con mock.
Antes de inferencia: HOME listo, bind frontal comprobado, controles positivos,
canario activo bloqueado desde OpenCode, sin puertos y producción intacta.
Después se requeriría autorización independiente para Ollama y cutover.

Pendientes: consumo real, interfaces runtime, readiness y parada, DNS general,
forwarding, egress propio del gateway, Internet de Ollama y validación efectiva
del reviewer y la activación con el backend en un ensayo posterior. No hay NIVEL 2 completo ni egress estricto.
No se añade Relay, microVM, regla de firewall o modificación productiva.

Ver [rollback propuesto](ROLLBACK.md). No se ejecutó.
