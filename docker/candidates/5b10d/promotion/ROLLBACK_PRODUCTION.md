# Rollback productivo — RECONCILIADO 5B.11B — NO EJECUTADO

**META A: NO-GO PRODUCTIVO.** Este procedimiento requiere autorización futura.
No se ha probado un rollback productivo; A→B→A temporal no lo certifica.

## Detener la intervención y conservar evidencia

Parar ante fallo de una puerta de CUTOVER/ACCEPTANCE, bypass, pérdida de isolated,
listener upstream, mount/privilegio inesperado, provider incorrecto, error SSE
no recuperado, OOM/presión incompatible o cambio inesperado en Ollama.
Mantener cierre de admisiones; preservar diagnóstico privado en un registro
nuevo, separado de ambos respaldos. No borrar estados inciertos ni repetir
inferencias. Si todavía hay trabajo incompatible o no clasificado, no iniciar
restauración destructiva: mantener cierre, escalar al operador y conciliarlo.
La parada del backend no demuestra terminación remota.

Reconfirmar control del backend y relanzadores, no solo ausencia puntual de PID.
Si ya arrancó para aceptación, volver a cerrar y conciliar antes de detenerlo
por el mecanismo autorizado. Ninguna instrucción permite parar Ollama.

## Fuentes y variables

Leer BACKUP_PLAN: tres configuraciones y modos desde principal; historial,
historyFile y modo original desde complemento. Ninguna referencia de historial
se busca en el principal. Seleccionar fuentes vigentes explícitas, sin sobrescribir
históricos. En rollback, contrastar respaldos con su metadata original; los
activos ya migrados no tienen por qué coincidir con ellos. Las diferencias deben
ser únicamente las del cambio autorizado, no trabajo concurrente desconocido.

```bash
ROOT_META_A=$(git rev-parse --show-toplevel)
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
COMPOSE_META_A="$ROOT_META_A/docker/docker-compose.yml"
STAGED_COMPOSE_META_A="$PKG_META_A/files/docker/docker-compose.yml"
NEW_HOME_META_A="$HOME/.local/share/lab-ia-opencode/home-meta-a"
IFS= read -r -p 'Directorio absoluto del principal verificado: ' BACKUP_META_A
IFS= read -r -p 'Directorio absoluto del complemento del historial: ' HISTORY_BACKUP_META_A
(cd "$BACKUP_META_A" && sha256sum --status -c SHA256SUMS)
(cd "$HISTORY_BACKUP_META_A" && sha256sum --status -c SHA256SUMS)
(cd "$HISTORY_BACKUP_META_A" && sha256sum --status -c PRECHECKS.sha256)
WORKSPACE_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
OLD_HOME_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["oldHome"])' "$BACKUP_META_A/references.json")
HISTORY_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["historyFile"])' "$HISTORY_BACKUP_META_A/references.json")
test -d "$OLD_HOME_META_A"
test -d "$NEW_HOME_META_A"
export LAB_WORKSPACE="$WORKSPACE_META_A"
export LAB_OPENCODE_HOME="$NEW_HOME_META_A"
cd "$ROOT_META_A"
```

Verificar permisos, hashes, ausencia de symlinks/archivos especiales y coherencia
entre workspace/oldHome/provider/baseBackup de ambas fuentes. Confirmar que
HISTORY_META_A es la ruta efectiva del backend; no publicar valores. No proceder
si las referencias difieren o faltan archivos. Conservar ambos HOME; restaurar
la referencia anterior no significa copiar datos del nuevo hacia el antiguo.

## Caso 1: Gateway preparado, OpenCode y activos todavía anteriores

No parar ni recrear OpenCode. Comparar identidad/configuración con el baseline.
Si difieren sin explicación, detenerse. Solo tras conciliar peticiones al Gateway
y verificar su ID/labels contra los recursos nuevos registrados:

```bash
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" stop opencode-gateway
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" rm -f opencode-gateway
```

Si no llegó a crearse, no adivinar IDs ni ejecutar retirada indiscriminada.
Un launcher nuevo sin uso no exige borrar nada para recuperar servicio.

## Caso 2: OpenCode migrado o cualquier activo sustituido

Backend detenido bajo control y trabajos conciliados antes de esta etapa.
Detener exclusivamente OpenCode objetivo:

```bash
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" stop opencode
```

Verificar detención real. Retirar Gateway según caso 1 solo si corresponde al
recurso creado en esta intervención y está sin trabajo. Si falla cualquier
operación, detenerse y conservar estado; no seguir restaurando una mezcla a ciegas.
Restaurar configuraciones, provider directo, lab-open y modos originales:

```bash
python3 - "$ROOT_META_A" "$BACKUP_META_A" "$HISTORY_BACKUP_META_A" <<'PY'
import json,sys,shutil,os,hashlib
from pathlib import Path
root,b,h=map(Path,sys.argv[1:])
m=json.loads((b/'metadata-before.json').read_text())
r=json.loads((b/'references.json').read_text())
hr=json.loads((h/'references.json').read_text())
hv=json.loads((h/'history-verification.json').read_text())
assert Path(hr['baseBackup']).resolve()==b.resolve()
assert all(r[k]==hr[k] for k in ['workspace','oldHome','provider'])
history=Path(hr['historyFile']);saved=h/'config/recent-workspaces'
assert hv['originalExists'] and str(history)==hv['originalPath']
assert not history.is_symlink() and not saved.is_symlink()
assert hashlib.sha256(saved.read_bytes()).hexdigest()==hv['sha256']
assert (hv['originalUid'],hv['originalGid'])==(os.getuid(),os.getgid())
pairs=[('docker/docker-compose.yml','docker-compose.yml'),('docker/opencode.json','opencode.json'),('scripts/lab-open','lab-open')]
for relative,saved_name in pairs:
    source=b/'config'/saved_name;destination=root/relative
    assert not source.is_symlink() and not destination.is_symlink()
    assert hashlib.sha256(source.read_bytes()).hexdigest()==m['files'][relative]['sha256']
assert json.loads((b/'config/opencode.json').read_text())['provider']['ollama']['options']['baseURL']==r['provider']
for relative,saved_name in pairs:
    source=b/'config'/saved_name;destination=root/relative
    shutil.copyfile(source,destination)
    os.chmod(destination,int(m['files'][relative]['mode'],8))
shutil.copyfile(saved,history)
os.chmod(history,int(hv['originalMode'],8))
assert hashlib.sha256(history.read_bytes()).hexdigest()==hv['sha256']
for relative,expected in m['files'].items():
    assert hashlib.sha256((root/relative).read_bytes()).hexdigest()==expected['sha256']
assert json.loads((root/'docker/opencode.json').read_text())['provider']['ollama']['options']['baseURL']==r['provider']
print('Restored configuration and history: PASS')
PY
unset LAB_OPENCODE_HOME
LAB_WORKSPACE="$WORKSPACE_META_A" docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$COMPOSE_META_A" config --quiet
```

Revisar config efectiva antes de recrear: referencia exacta de OLD_HOME_META_A,
workspace original RO, red y hardening originales, provider directo anterior,
Ollama/volumen intactos. Solo si todos pasan:

```bash
LAB_WORKSPACE="$WORKSPACE_META_A" docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$COMPOSE_META_A" up -d --no-deps --force-recreate --pull never --no-build opencode
```

OpenCode tendrá nuevo ID/StartedAt; no declarar que se recuperaron los antiguos.
No recrear Ollama, backend ni datos externos para restaurar OpenCode.

## Comprobación funcional y reapertura

Verificar mounts normalizados, HOME anterior, provider directo, puertos,
red original, hardening y workspace. Comprobar acceso original a Ollama con GET
inocuo autorizado; una generación de recuperación exige autorización y recursos
específicos, sin retries manuales. Comparar Ollama y otras aplicaciones contra
baseline. Backend se arranca por su mecanismo previamente verificado, con
warmup autorizado, conservando acceso exclusivo y auth/CSRF para comprobar
servicio en 127.0.0.1:3001. Si no puede preservarse exclusividad, no arrancarlo
para simular aceptación. No declarar recuperación funcional sin comprobarla.
Reabrir a clientes solo con autorización humana tras estas verificaciones.

## Retirada opcional y fallo parcial

No es necesario eliminar redes/launcher/HOME nuevo para restaurar servicio.
Retirar redes nuevas únicamente si están vacías, IDs y labels coinciden con
la intervención, no están compartidas y existe autorización específica:

```bash
docker network inspect docker_front docker_upstream
docker network rm docker_front
docker network rm docker_upstream
```

Revisar cada red antes de cada rm; ante fallo detener, no continuar al siguiente.
Nunca eliminar docker_default, bridge, redes de terceros, volúmenes o modelos.
Sin down, prune, reinicio de Ollama ni borrado de HOME, sesiones o SQLite.
Conservar ambos respaldos, ambos HOME e imágenes hasta cierre aprobado.

Fallo parcial: mantener admisión cerrada, registrar punto y evidencia privada,
identificar configuraciones efectivamente restauradas y trabajos pendientes.
No borrar incertidumbres, no reabrir automáticamente, no repetir comandos a
ciegas ni continuar eliminando recursos. Requiere decisión/autorización separada
del operador. Git queda bajo administración manual del usuario.
