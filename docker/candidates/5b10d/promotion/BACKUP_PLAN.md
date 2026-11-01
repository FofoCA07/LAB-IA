# Respaldo previo — PREPARADO — NO EJECUTADO

Precondiciones: autorización futura, ventana exclusiva acordada, UID/GID 1000,
Git/paquete sin cambios inesperados, baseline fresco y runtime del backend
identificado. No copiar HOME, auth, sesiones, SQLite, SSH ni credenciales.
El HOME anterior se conserva en su ubicación; se respalda su referencia.

## Crear respaldo privado fuera de Git

Comandos futuros, en una misma terminal; abortar ante cualquier error:

```bash
set -euo pipefail
umask 077
ROOT_META_A=/home/adolf/LAB-IA
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
BACKUP_BASE_META_A="$HOME/.local/state/lab-ia-meta-a/backups"
RUNTIME_META_A="${LAB_RUNTIME_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/lab-ia}"
HISTORY_META_A="$RUNTIME_META_A/recent-workspaces"
cd "$ROOT_META_A"
test "$(id -u)" = 1000
test "$(id -g)" = 1000
test "$RUNTIME_META_A" = "$(realpath -m -- "$RUNTIME_META_A")"
install -d -m 0700 "$BACKUP_BASE_META_A"
BACKUP_META_A="$BACKUP_BASE_META_A/$(date -u +%Y%m%dT%H%M%SZ)"
test ! -e "$BACKUP_META_A"
mkdir -m 0700 "$BACKUP_META_A"
mkdir -m 0700 "$BACKUP_META_A/config"
cp -p -- docker/docker-compose.yml "$BACKUP_META_A/config/docker-compose.yml"
cp -p -- docker/opencode.json "$BACKUP_META_A/config/opencode.json"
cp -p -- scripts/lab-open "$BACKUP_META_A/config/lab-open"
python3 "$PKG_META_A/snapshot.py" > "$BACKUP_META_A/metadata-before.json"
```

Antes de continuar, confirmar que RUNTIME_META_A coincide con el runtime del
backend en ejecución. La fórmula respeta LAB_RUNTIME_DIR/XDG_STATE_HOME, pero
una terminal puede tener otro entorno. No asumir igualdad ni imprimir su entorno.
Si no puede confirmarse la ruta de historial efectiva, detener.

El baseline debe confirmar opencode del proyecto docker con el Compose activo
esperado, workspace bind RO y HOME dedicado. Registrar referencias sin shell code:

```bash
python3 - "$BACKUP_META_A" "$HISTORY_META_A" <<'PY'
import json,sys
from pathlib import Path
b=Path(sys.argv[1]); history=Path(sys.argv[2])
m=json.loads((b/'metadata-before.json').read_text())
oc=m['containers']['opencode']; mounts={x['Destination']:x for x in oc['Mounts']}
assert oc['State']=='running' and m['containers']['ollama']['State']=='running'
assert oc['Compose']['com.docker.compose.project']=='docker'
assert oc['Compose']['com.docker.compose.project.config_files']=='/home/adolf/LAB-IA/docker/docker-compose.yml'
assert mounts['/workspace']['Type']=='bind' and mounts['/workspace']['RW'] is False
workspace=mounts['/workspace']['Source']; oldhome=mounts['/home/adolf']['Source']
assert Path(workspace).is_dir() and Path(oldhome).is_dir()
assert history.is_file() and not history.is_symlink()
assert workspace in history.read_text().splitlines(), 'Original workspace must already be authorized'
(b/'references.json').write_text(json.dumps({'workspace':workspace,'oldHome':oldhome,'historyFile':str(history)},indent=2)+'\n')
PY
cp -p -- "$HISTORY_META_A" "$BACKUP_META_A/config/recent-workspaces"
chmod 0600 "$BACKUP_META_A"/*.json "$BACKUP_META_A/config/"*
```

No se abre contenido del HOME anterior. Historial solo se copia al respaldo
privado por ser necesario para restaurar selección de workspaces; no publicarlo.
No se respalda ni cambia la base privada del backend: no forma parte del cambio.

## Integridad y lectura: puerta obligatoria

```bash
cd "$BACKUP_META_A"
sha256sum config/docker-compose.yml config/opencode.json config/lab-open config/recent-workspaces metadata-before.json references.json > SHA256SUMS
chmod 0600 SHA256SUMS
sha256sum -c SHA256SUMS
bash -n config/lab-open
python3 - <<'PY'
import json
from pathlib import Path
for name in ['config/opencode.json','metadata-before.json','references.json']:
    json.loads(Path(name).read_text())
for file in Path('config').iterdir():
    assert file.is_file() and file.stat().st_size>0
assert json.loads(Path('config/opencode.json').read_text())['provider']['ollama']['options']['baseURL']=='http://host.docker.internal:11434/v1'
PY
```

Además validar el Compose antiguo sin cambiar su base de paths:

```bash
WORKSPACE_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
LAB_WORKSPACE="$WORKSPACE_META_A" docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$BACKUP_META_A/config/docker-compose.yml" config --quiet
```

Esperado: checksums y lectura PASS; no discrepancias con baseline. No ejecutar
config --environment ni publicar metadata/paths privados. Mantener respaldo
inmutable durante cutover y rollback. Si falla lectura, checksum o consistencia,
NO-GO; no parar OpenCode ni sustituir archivos. Guardar la ruta del respaldo para
la intervención: los otros documentos la solicitan explícitamente, no eligen
automáticamente el backup más reciente.
