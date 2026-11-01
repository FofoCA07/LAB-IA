# Rollback productivo — PREPARADO — NO EJECUTADO

Aplicar solo con autorización futura y trabajo drenado. No eliminar recursos
para intentar arreglar una discrepancia. Primero verificar el respaldo.

## Variables y puerta inicial

```bash
set -euo pipefail
ROOT_META_A=/home/adolf/LAB-IA
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
COMPOSE_META_A="$ROOT_META_A/docker/docker-compose.yml"
STAGED_COMPOSE_META_A="$PKG_META_A/files/docker/docker-compose.yml"
NEW_HOME_META_A="$HOME/.local/share/lab-ia-opencode/home-meta-a"
IFS= read -r -p 'Ruta absoluta del respaldo verificado: ' BACKUP_META_A
test -d "$BACKUP_META_A"
cd "$BACKUP_META_A"
sha256sum -c SHA256SUMS
WORKSPACE_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
OLD_HOME_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["oldHome"])' "$BACKUP_META_A/references.json")
HISTORY_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["historyFile"])' "$BACKUP_META_A/references.json")
test -d "$OLD_HOME_META_A"
export LAB_WORKSPACE="$WORKSPACE_META_A"
export LAB_OPENCODE_HOME="$NEW_HOME_META_A"
cd "$ROOT_META_A"
```

Reconfirmar exclusividad: detener nuevas invocaciones del backend/UI/CLI mediante
el mecanismo operativo acordado, esperar trabajos y no matar procesos ajenos.

## Caso 1: solo Gateway nuevo, OpenCode aún no migrado

No parar OpenCode anterior. Comparar su metadata con baseline. Usar el Compose
staged con paths finales para retirar solo el nuevo servicio:

```bash
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" stop opencode-gateway
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" rm -f opencode-gateway
```

Continuar a la retirada condicionada de redes. El HOME nuevo se conserva por
ahora; no se borra el anterior. Si el gateway no llegó a crearse, no adivinar
IDs: inspeccionar los recursos etiquetados y retirar solo los registrados.

## Caso 2: OpenCode ya migrado o archivos activos sustituidos

```bash
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" stop opencode
```

Retirar Gateway con el Compose staged (comandos del caso 1), antes de restaurar
el Compose antiguo. Verificar que el servicio retirado corresponde al ID nuevo
registrado, nunca a un recurso preexistente de otro propietario.

Restaurar tres archivos y modos guardados, con OpenCode detenido:

```bash
python3 - "$ROOT_META_A" "$BACKUP_META_A" <<'PY'
import json,sys,shutil,os
from pathlib import Path
root,backup=map(Path,sys.argv[1:]);metadata=json.loads((backup/'metadata-before.json').read_text())
for relative,saved in [('docker/docker-compose.yml','docker-compose.yml'),('docker/opencode.json','opencode.json'),('scripts/lab-open','lab-open')]:
    source=backup/'config'/saved;destination=root/relative
    shutil.copyfile(source,destination)
    os.chmod(destination,int(metadata['files'][relative]['mode'],8))
PY
cp -p -- "$BACKUP_META_A/config/recent-workspaces" "$HISTORY_META_A"
```

Comprobar hashes de los tres activos contra metadata-before.json y provider
directo anterior. El Compose restaurado recupera la referencia del HOME anterior;
no se restaura copiando datos desde HOME nuevo.

```bash
python3 - "$ROOT_META_A" "$BACKUP_META_A" <<'PY'
import json,sys,hashlib
from pathlib import Path
root,backup=map(Path,sys.argv[1:]);metadata=json.loads((backup/'metadata-before.json').read_text())
for relative,expected in metadata['files'].items():
    assert hashlib.sha256((root/relative).read_bytes()).hexdigest()==expected['sha256']
assert json.loads((root/'docker/opencode.json').read_text())['provider']['ollama']['options']['baseURL']=='http://host.docker.internal:11434/v1'
PY
unset LAB_OPENCODE_HOME
LAB_WORKSPACE="$WORKSPACE_META_A" docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$COMPOSE_META_A" config --quiet
LAB_WORKSPACE="$WORKSPACE_META_A" docker compose -p docker -f "$COMPOSE_META_A" up -d --no-deps --force-recreate --pull never --no-build opencode
```

Verificar /workspace Source original RO, HOME Source OLD_HOME_META_A, red
docker_default original, hardening anterior y provider directo. ID/StartedAt de
OpenCode serán nuevos; no presentarlos como restaurados. Confirmar versión,
backend/status y acceso administrativo loopback a Ollama; cualquier generación
de prueba requiere autorización específica, sin retries automáticos.

## Retirada condicionada y fallo parcial

Solo tras recuperar función e invariantes, inspeccionar nombres, labels y
endpoints de las redes nuevas. Deben corresponder a los IDs del despliegue y
estar vacías. Entonces, individualmente:

```bash
docker network inspect docker_front docker_upstream
docker network rm docker_front
docker network rm docker_upstream
```

No ejecutar rm si no coinciden propietario/ID o hay endpoints. Nunca borrar
docker_default, bridge, sqlnet, technova-network ni volúmenes. No usar down,
prune o reinicio de Ollama. Conservar HOME nuevo, launcher nuevo, backups e
imágenes hasta cerrar la incidencia; no es necesario borrarlos para restaurar.

Si el rollback falla parcialmente: mantener la ventana cerrada, registrar
metadata/IDs y punto fallido, no repetir a ciegas, no seguir eliminando recursos.
Conservar ambos HOME y el respaldo válido; corregir con autorización separada.
Comparar Ollama y aplicaciones ajenas contra baseline antes de reabrir servicio.
