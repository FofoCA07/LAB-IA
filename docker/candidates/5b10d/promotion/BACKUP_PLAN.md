# Respaldos — RECONCILIADO 5B.11B — SIN DESPLIEGUE

**META A: NO-GO PRODUCTIVO.** Este documento no crea respaldos ni autoriza
intervención. Sustituye el supuesto histórico de un único respaldo por dos
fuentes existentes, verificadas en 5B.10K/L y revalidadas en 5B.11A.

## Fuentes y vigencia

| Fuente privada | Contenido y uso |
|---|---|
| Principal | config/docker-compose.yml, config/opencode.json, config/lab-open, metadata-before.json, references.json y checksums; restauración de configuración |
| Complemento del historial | config/recent-workspaces, references.json, history-verification.json y checksums; ruta efectiva, contenido y modo original del historial |
| HOME anterior | Permanece físicamente intacto; el respaldo principal conserva su referencia, no sus datos |
| HOME sanitizado preparado | Se valida en CUTOVER A; no se vuelve a preparar ni se copia al respaldo |

Seleccionar ambos directorios explícitamente a partir del registro privado del
operador. No elegir automáticamente el más reciente. El principal no contiene
historyFile ni config/recent-workspaces: obtenerlos del complemento. No copiar
HOME, auth, sesiones, SQLite, SSH ni credenciales. Las rutas y el historial no
se publican ni se incorporan a Git.

La integridad de un respaldo histórico no demuestra su vigencia. Antes de una
intervención futura, comparar bytes/modos de los tres activos, historial, workspace,
HOME y configuración estructural con el estado actual. StartedAt, EndpointID o
NetworkID dinámicos requieren conciliación separada, no recreación del respaldo
por sí solos. Cambios legítimos de archivos o referencias requieren detenerse y
obtener autorización para una copia fresca o complemento nuevo y exclusivo;
no sobrescribir las dos fuentes históricas ni utilizarlas como estado actual.
Esta fase no autoriza ni ejecuta esa copia.

## Verificación futura de lectura

Precondiciones: autorización de auditoría, acceso del operador UID/GID 1000:1000,
rutas revisadas fuera de Git, sin symlinks ni archivos especiales, directorios
0700 y archivos privados 0600. Revisar también ancestros y propietarios. No usar
sudo para superar errores. Ejecutar individualmente y detenerse ante cualquier fallo.

```bash
ROOT_META_A=$(git rev-parse --show-toplevel)
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
IFS= read -r -p 'Directorio absoluto del respaldo principal existente: ' BACKUP_META_A
IFS= read -r -p 'Directorio absoluto del complemento del historial: ' HISTORY_BACKUP_META_A
test -d "$BACKUP_META_A"
test -d "$HISTORY_BACKUP_META_A"
test "$BACKUP_META_A" != "$HISTORY_BACKUP_META_A"
(cd "$BACKUP_META_A" && sha256sum --status -c SHA256SUMS)
(cd "$HISTORY_BACKUP_META_A" && sha256sum --status -c SHA256SUMS)
(cd "$HISTORY_BACKUP_META_A" && sha256sum --status -c PRECHECKS.sha256)
```

Los checksums no imprimen contenido ni rutas internas. Verificar su alcance:
los archivos de configuración y sus referencias deben estar cubiertos. Los
registros privados adicionales también deben contrastarse con la evidencia de
verificación existente; no regenerar checksums para ocultar diferencias.

```bash
python3 - "$ROOT_META_A" "$BACKUP_META_A" "$HISTORY_BACKUP_META_A" <<'PY'
import json,sys,hashlib,stat
from pathlib import Path
root,b,h=map(Path,sys.argv[1:])
for folder in [b,h]:
    assert folder.is_absolute() and folder.resolve()==folder
    assert not folder.is_relative_to(root.resolve())
    for p in [folder,*folder.rglob('*')]:
        s=p.lstat()
        assert not stat.S_ISLNK(s.st_mode)
        assert stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)
        assert (s.st_uid,s.st_gid)==(1000,1000)
        assert stat.S_IMODE(s.st_mode)==(0o700 if p.is_dir() else 0o600)
        if p.is_file():
            with p.open('rb') as stream: stream.read(1)
m=json.loads((b/'metadata-before.json').read_text())
r=json.loads((b/'references.json').read_text())
hr=json.loads((h/'references.json').read_text())
hv=json.loads((h/'history-verification.json').read_text())
assert Path(hr['baseBackup']).resolve()==b.resolve()
assert all(r[k]==hr[k] for k in ['workspace','oldHome','provider'])
assert hv['originalExists'] is True
assert hr['historyFile']==hv['originalPath']
assert hashlib.sha256((h/'config/recent-workspaces').read_bytes()).hexdigest()==hv['sha256']
for relative,saved in [('docker/docker-compose.yml','docker-compose.yml'),('docker/opencode.json','opencode.json'),('scripts/lab-open','lab-open')]:
    src=b/'config'/saved;active=root/relative
    assert src.is_file() and not active.is_symlink()
    expected=m['files'][relative]
    assert hashlib.sha256(src.read_bytes()).hexdigest()==expected['sha256']
    assert active.read_bytes()==src.read_bytes(), 'Configuration changed: new authorized backup required'
    assert stat.S_IMODE(active.stat().st_mode)==int(expected['mode'],8)
history=Path(hr['historyFile'])
assert history.is_file() and not history.is_symlink()
assert history.read_bytes()==(h/'config/recent-workspaces').read_bytes(), 'History changed: new authorized complement required'
assert stat.S_IMODE(history.stat().st_mode)==int(hv['originalMode'],8)
assert (history.stat().st_uid,history.stat().st_gid)==(hv['originalUid'],hv['originalGid'])
assert Path(r['oldHome']).is_dir() and Path(r['workspace']).is_dir()
print('Backup files, references and current file contents: PASS')
PY
```

Además comparar por inspección privada los mounts actuales con oldHome/workspace
registrados, redes, puertos, imágenes, identidad de contenedores y provider anterior.
No basta que las rutas existan. Confirmar historyFile efectivo del backend;
la terminal del operador puede tener LAB_RUNTIME_DIR/XDG_STATE_HOME distintos.
No imprimir el entorno ni el historial. Validar el Compose anterior con su base
de rutas original, sin crear recursos:

```bash
WORKSPACE_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
LAB_WORKSPACE="$WORKSPACE_META_A" docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$BACKUP_META_A/config/docker-compose.yml" config --quiet
```

## Resultado y evidencia

**BACKUP VERIFICADO** exige checksums, lectura, permisos, referencias y vigencia
PASS para ambas fuentes. No significa **ROLLBACK PRODUCTIVO EJECUTADO**.
Cualquier diferencia sin conciliar implica NO-GO antes de parar servicios.
Una selección nueva de workspaces puede modificar el historial: revalidarlo
antes del cambio y no restaurar después una copia que descarte cambios legítimos.

Guardar resultados futuros en metadata privada nueva, con umask 077 y permisos
restrictivos, fuera de Git; nunca añadirlos al respaldo principal o complemento
inmutables. Esta fase no crea esa metadata ni ejecuta estos bloques.
