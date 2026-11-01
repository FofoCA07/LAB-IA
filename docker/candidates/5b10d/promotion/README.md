# META A — PREPARADO — NO DESPLEGADO

Paquete de 5B.10I sobre HEAD `b0c4f9b`. No autoriza cutover. Ningún comando
operativo de estos documentos se ejecutó al prepararlo. No hay script de cutover
integral: cada puerta exige revisión y autorización posterior.

## Contenido y rutas definitivas

| Archivo del paquete | Destino futuro | Operación |
|---|---|---|
| files/docker/docker-compose.yml | docker/docker-compose.yml | Sustituir después del respaldo y parada de OpenCode |
| files/docker/opencode.json | docker/opencode.json | Sustituir con OpenCode detenido |
| files/scripts/lab-open | scripts/lab-open | Sustituir, modo 0755; mismo contrato de un argumento |
| files/docker/gateway-launcher.mjs | docker/gateway-launcher.mjs | Nuevo archivo RO para el servicio |
| prepare_home.py | No se instala como servicio | Paso administrativo único, solo con autorización |
| snapshot.py | No se instala como servicio | Solo metadata; salida privada fuera de Git |

No se copia ni modifica `proyectos/lab-ia-web/server/opencode-gateway.js`.
Compose lo monta RO con destino `/app/opencode-gateway.mjs`; su launcher es
idéntico al candidato validado. Provider también idéntico al de 5B.10G.
`PATH_REBASE.diff` identifica exclusivamente ajustes de rutas y comentarios.
No hay dependencia runtime del directorio de candidatos en los cuatro archivos
de instalación. Los snapshots de instalación evitan editar activos al preparar.
Las herramientas administrativas sí contrastan las fuentes candidatas auditadas:
conservarlas durante la intervención. No se montan en los contenedores.

Rutas host propuestas (no creadas en esta fase):

- Raíz: `/home/adolf/LAB-IA`; proyecto Compose `docker`.
- HOME nuevo: `${HOME}/.local/share/lab-ia-opencode/home-meta-a`, persistente RW.
- HOME anterior: conservar el Source real del mount `/home/adolf` del baseline.
- Workspace: Source explícito `LAB_WORKSPACE`, siempre bind RO.
- Agentes: `agentes/agents`, RO; configuración: `docker/opencode.json`, RO.
- Backups: `${HOME}/.local/state/lab-ia-meta-a/backups/<fecha-UTC>`, fuera de Git.
- Logs Gateway: driver Docker `local`, máximo 3 × 1 MiB, solo metadata segura.
  No se agrega bind de logs. Estado propio de OpenCode vive solo en HOME nuevo.
- Backend, SQLite privada, SSH, credenciales, Ollama y volumen `ollama`: intactos.

## Arquitectura y evidencia

```text
OpenCode [solo FRONT] --> Gateway [FRONT + UPSTREAM] --> host.docker.internal:11434
Backend LAB-IA -------------------------------------> 127.0.0.1:11434
```

FRONT `docker_front`: bridge internal + gateway_mode_ipv4=isolated, IPv6=false.
UPSTREAM `docker_upstream`: bridge convencional dedicado, IPv6=false.
Sin subred fija; inspeccionar asignación y solapamientos antes de aceptar.
No usar ni borrar docker_default, bridge, sqlnet o technova-network.
Ollama conserva su bridge, publicación loopback y volumen actuales.

Gateway descubre la única IPv4 válida de front0 y solo escucha allí:8080;
upstream0 tiene gw_priority=1. Upstream fijo, qwen3:8b, maxConcurrent=1,
timeouts y validaciones originales. 256 MiB y 0,5 CPU. Sin puertos publicados.
Ambos servicios preservan UID/GID, rootfs RO, capabilities eliminadas,
no-new-privileges, pids_limit 256 e init. OpenCode conserva workspace RO y sus
variables de desactivación remota; sin host-gateway/extra_hosts en OpenCode.

Resultados reportados: 5B.10G reviewer/mock/parser/SSE PASS; 5B.10H.1 A→B→A
PASS con 29 invariantes por etapa. La causa histórica del fallo de 5B.10H sigue
NO DETERMINADA. No se reproducen pruebas de red o inferencia en 5B.10I.

## Precheck futuro: solo después de autorización

Desde una terminal WSL del operador UID/GID 1000:1000. En cada terminal:

```bash
ROOT_META_A=/home/adolf/LAB-IA
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
NEW_HOME_META_A="$HOME/.local/share/lab-ia-opencode/home-meta-a"
cd "$ROOT_META_A"
git status --short --untracked-files=all
git log -1 --oneline
git diff --check
id
docker compose version
docker info --format 'Engine={{.ServerVersion}} Memory={{.MemTotal}} CPUs={{.NCPU}}'
docker stats --no-stream opencode ollama
docker network ls
docker ps -a --format '{{.Names}} {{.Status}} {{.Networks}}'
```

Revisar MANIFEST.sha256 antes de usar el paquete; sus hashes prueban consistencia,
no firma ni confianza externa. Confirmar que la versión revisada sigue vigente.

```bash
cd "$PKG_META_A"
sha256sum -c MANIFEST.sha256
python3 "$PKG_META_A/verify_package.py"
docker image inspect ghcr.io/anomalyco/opencode@sha256:bf9d0e84b7cedef436a8f57db4d48767cd5d8fc6604f666335c1cc916b199a97 --format '{{.Id}} {{.Os}}/{{.Architecture}}'
docker image inspect docker.io/library/node@sha256:9f0dde62d10e7ff7a310ecaebd66225f6b46c17e6cb778449a77b05d3541bea2 --format '{{.Id}} {{.Os}}/{{.Architecture}}'
```

Parar si faltan imágenes; nunca sustituir tags ni descargar. Revisar colisiones
de servicio opencode-gateway, red docker_front/docker_upstream y archivo nuevo
docker/gateway-launcher.mjs. Una red preexistente inesperada no se reutiliza.
Confirmar permisos de los binds y ausencia de symlinks hacia datos privados.

Recursos: el presupuesto adicional es Gateway 256 MiB más tmpfs acotado y caché
del Engine. Muestras históricas no garantizan RAM libre durante carga de Ollama.
Exigir margen host/VM suficiente observado para cargar qwen3:8b y Gateway,
sin OOM ni swapping incompatible; incertidumbre o presión de RAM = NO-GO.

## Puertas de decisión

1. Paquete revisado, runtime local sin discrepancias y autorización explícita.
2. Respaldo verificable y HOME nuevo preparado sin tocar el anterior.
3. Gateway preparado/healthy y GET administrativos correctos, Ollama intacto.
4. Ventana exclusiva: ningún cliente podrá iniciar summary, activación o CLI.
   No se verificó una API de mantenimiento del backend. El operador debe poder
   garantizar el drenaje con su mecanismo operativo existente; si no, NO-GO.
5. Solo entonces parar/recrear OpenCode y aplicar [CUTOVER.md](CUTOVER.md).
6. [ACCEPTANCE.md](ACCEPTANCE.md) completo o [rollback](ROLLBACK_PRODUCTION.md).

Un exit 0 no sustituye los invariantes. Parar ante listener upstream, bypass,
mount privado, pérdida de isolated, provider incorrecto o cambio en Ollama.

## Riesgos aceptados y pendientes

META A es aislamiento frontal y restricción HTTP. Gateway conserva salida
convencional: no existe enforcement independiente de egress validado. DNS
general y forwarding siguen pendientes; ip_forward=1 no prueba ni descarta
tránsito utilizable. Internet de Ollama no está aislado completamente.
No se declara NIVEL 2 completo ni compatibilidad universal de otros agentes.
El gateway admite algunas tools válidas: workspace summary depende de su
configuración efectiva de tools=false y permission=deny, que no cambia.

Persisten 20 paquetes con versiones/hashes locales sin tarball SRI contrastado;
solo 7 tuvieron contraste SRI. No afirmar autenticidad criptográfica completa.
Un rollback no recupera el ID/StartedAt anterior de OpenCode ni una sesión activa.

## Validación estática de este paquete

Usar un TMPDIR bajo candidatos para las fixtures; borrarlo específicamente al
terminar. No ejecutar prepare_home.py --prepare-new-home en una validación.

```bash
ROOT_META_A=/home/adolf/LAB-IA
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
cd "$ROOT_META_A"
mkdir -p "$PKG_META_A/.validation-work"
TMPDIR="$PKG_META_A/.validation-work" python3 "$PKG_META_A/test_package.py"
node --test docker/candidates/5b10d/gateway-launcher.test.mjs
python3 docker/candidates/5b10d/home-audit.py
bash -n "$PKG_META_A/files/scripts/lab-open"
node --check "$PKG_META_A/files/docker/gateway-launcher.mjs"
rmdir "$PKG_META_A/.validation-work"
git diff --check
```

La auditoría HOME sin flags no copia ni modifica inventario. Tests con shims
no invocan Docker productivo; Compose config es exclusivamente un parser.
