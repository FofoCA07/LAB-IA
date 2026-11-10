# Aceptación productiva futura — RECONCILIADO 5B.11B — NO EJECUTADO

**META A — NO-GO PRODUCTIVO.** Puerta previa futura: CUTOVER A–E aprobado,
paquete con integridad revisada, OpenCode nuevo, cierre técnico mantenido y
operaciones incompatibles conciliadas. Ambas fuentes de respaldo deben estar
legibles y vigentes, HOME validado y criterios de recursos aprobados.
No se autoriza ninguna ejecución en 5B.11B.

Presupuesto propuesto: exactamente DOS invocaciones principales con generación
real en Ollama, ambas autorizadas previamente: una CLI instrumentada y una por
backend. Un workspace sintético no convierte la inferencia en mock. GET,
startup/warmup, acceso administrativo y carga adicional requieren alcance explícito.
Si solo se autoriza una medición preliminar, eso no es aceptación completa.
Sin retries manuales; 429 internos recuperados pueden aceptarse con evidencia.
Cada criterio debe tener ID, esperado, observado y PASS/FAIL. Un criterio sin
evidencia se registra NO VERIFICADO y bloquea aceptación. No ampliar límites.

## Dominios de aceptación separados

| Dominio | Evidencia productiva futura requerida |
|---|---|
| Estructura | Configuración efectiva, imágenes por digest, mounts, provider, modelo y hardening previstos |
| Disponibilidad | Gateway healthy y alcanzable exclusivamente por su interfaz frontal |
| HTTP/SSE | Status, contrato de denegaciones, finalización de streams y [DONE]; HTTP 200 inicial no basta |
| Ollama real | Destino local existente confirmado, GET permitidos y generación autorizada con qwen3:8b; sin cambiar servicio/modelos |
| Reviewer/parser | Exit 0, parser real PASS, tools=false/permission=deny, sin herramientas ejecutadas ni errores no recuperados |
| Aislamiento | FRONT exclusiva/isolated, sin bypass ensayado, listener Gateway no accesible por UPSTREAM |
| Persistencia | Ambos HOME preservados, solo estado técnico nuevo esperado en HOME nuevo; workspace RO, historial restaurado, modelos/volumen y SQLite original conservados |
| Rendimiento/memoria | Duración, memoria disponible/pico, swap, OOM/reinicios e impacto en servicios; no inferir capacidad de cifras en reposo |
| Recuperación | A→B→A y retorno original con invariantes; rollback productivo solo si se ejecuta y verifica expresamente |

Los ensayos temporales históricos no satisfacen por sí solos esta tabla.
NIVEL 2 estricto no declarado; egress Gateway, DNS general, forwarding e Internet
de Ollama mantienen los límites documentados. No se garantiza todo agente.

Para probar HTTP del backend tras CUTOVER D, autorizar su arranque por el mecanismo
verificado y el warmup asociado. El cierre técnico a terceros debe continuar
operativo con el backend arrancado. Si no se puede demostrar, detener aceptación:
no reabrir servicio general para probarlo. Conservar autenticación/CSRF existentes.
No usar barreras ni parches T/U rechazados para rellenar esta condición.

## Variables e invariantes de red antes del reviewer

```bash
ROOT_META_A=$(git rev-parse --show-toplevel)
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
COMPOSE_META_A="$ROOT_META_A/docker/docker-compose.yml"
NEW_HOME_META_A="$HOME/.local/share/lab-ia-opencode/home-meta-a"
IFS= read -r -p 'Directorio absoluto del principal verificado: ' BACKUP_META_A
IFS= read -r -p 'Directorio absoluto del complemento del historial: ' HISTORY_BACKUP_META_A
test -d "$BACKUP_META_A"
test -d "$HISTORY_BACKUP_META_A"
(cd "$BACKUP_META_A" && sha256sum --status -c SHA256SUMS)
(cd "$HISTORY_BACKUP_META_A" && sha256sum --status -c SHA256SUMS)
(cd "$HISTORY_BACKUP_META_A" && sha256sum --status -c PRECHECKS.sha256)
WORKSPACE_ORIGINAL_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
HISTORY_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["historyFile"])' "$HISTORY_BACKUP_META_A/references.json")
export LAB_WORKSPACE="$WORKSPACE_ORIGINAL_META_A"
export LAB_OPENCODE_HOME="$NEW_HOME_META_A"
cd "$ROOT_META_A"
docker network inspect docker_front docker_upstream
docker inspect opencode --format '{{json .NetworkSettings.Networks}} {{json .HostConfig.PortBindings}} {{json .HostConfig.ExtraHosts}}'
GATEWAY_ID_META_A=$(docker compose -p docker -f "$COMPOSE_META_A" ps -q opencode-gateway)
test -n "$GATEWAY_ID_META_A"
FRONT_IP_META_A=$(docker inspect "$GATEWAY_ID_META_A" --format '{{(index .NetworkSettings.Networks "docker_front").IPAddress}}')
UPSTREAM_IP_META_A=$(docker inspect "$GATEWAY_ID_META_A" --format '{{(index .NetworkSettings.Networks "docker_upstream").IPAddress}}')
OLLAMA_IP_META_A=$(docker inspect ollama --format '{{(index .NetworkSettings.Networks "bridge").IPAddress}}')
HOST_IP_META_A=$(docker compose -p docker -f "$COMPOSE_META_A" exec -T opencode-gateway node -e "require('dns').lookup('host.docker.internal',(e,a)=>{if(e)process.exit(1);console.log(a)})")
docker exec opencode cat /proc/net/route
docker exec opencode cat /proc/net/if_inet6
docker exec opencode cat /proc/net/ipv6_route
docker exec "$GATEWAY_ID_META_A" cat /proc/net/tcp /proc/net/tcp6
```

| ID | Criterio y evidencia |
|---|---|
| NET-01 | FRONT bridge/internal/isolated, IPv6=false; UPSTREAM bridge dedicado, IPv6=false |
| NET-02 | OpenCode exactamente docker_front; Gateway exactamente FRONT+UPSTREAM |
| NET-03 | UID/GID, rootfs RO, capabilities, no-new-privileges, pids/init iguales al paquete |
| NET-04 | Sin PortBindings ni extra_hosts en OpenCode; sin puertos publicados en Gateway |
| NET-05 | /workspace bind RO y HOME Source nuevo; destinos exactos y configuración/agentes RO |
| NET-06 | Socket 8080 solo FRONT_IP; ninguna escucha wildcard, IPv6 o UPSTREAM_IP |
| NET-07 | Sin ruta IPv4 por defecto ni ruta IPv6 externa utilizable desde OpenCode |
| NET-08 | Ollama conserva ID, StartedAt, red, publicación y volumen del baseline |

Positivo: GET /api/tags al Gateway debe devolver HTTP 404 (wget suele salir 1
por ese status). Capturar status de stderr sin imprimir cuerpos:

```bash
if CONTROL_META_A=$(docker exec opencode /usr/bin/wget -t 1 -T 3 -S -O /dev/null http://opencode-gateway:8080/api/tags 2>&1); then
  printf '%s\n' 'FAIL: se esperaba 404, no éxito de wget'
else
  printf '%s\n' "$CONTROL_META_A" | rg 'HTTP/[^ ]+ 404'
fi
```

Negativos, con destinos obtenidos de inspect/resolución y GET inocuos:

```bash
docker exec opencode /usr/bin/wget -t 1 -T 3 -S -O /dev/null "http://$OLLAMA_IP_META_A:11434/api/version"
docker exec opencode /usr/bin/wget -t 1 -T 3 -S -O /dev/null "http://$HOST_IP_META_A:11434/api/version"
docker exec opencode /usr/bin/wget -t 1 -T 3 -S -O /dev/null "http://$UPSTREAM_IP_META_A:8080/api/tags"
```

Ejecutarlos individualmente, registrando error y ausencia de HTTP. Cualquier
respuesta HTTP directa = NO-GO. Un error de comando/herramienta o DNS no prueba
bloqueo de red. Mantener control frontal positivo después. El servicio Ollama
debe haberse demostrado activo mediante GET desde Gateway en CUTOVER.

Para otra red Docker usar un canario temporal activo autorizado, sin conectar
producción a redes nuevas ni publicar puertos; su IP real debe estar accesible
desde Gateway y bloqueada desde OpenCode. No probar servicios privados ajenos.
No reutilizar IPs históricas como si fueran controles activos.

TCP externo sin HTTP/TLS: primero comprobar cliente disponible y sus flags;
no instalar/copiar herramientas para superar el control:

```bash
docker exec opencode /bin/sh -c 'command -v nc'
docker exec opencode nc -h
docker exec -i opencode nc -w 3 "$FRONT_IP_META_A" 8080 < /dev/null
docker exec -i opencode nc -w 3 1.1.1.1 443 < /dev/null
```

Solo ejecutar la última conexión una vez si el cliente/timeout y el control
TCP frontal funcionaron. No enviar datos de aplicación. Conexión externa =
NO-GO. Si falta herramienta o no es verificable el resultado, NO VERIFICADO,
no PASS; requiere un arnés aprobado antes de continuar. Un destino bloqueado
no prueba bloqueo universal. DNS externo/forwarding quedan separados y pendientes.

## Preparar workspaces sintéticos, sin leer los privados

Con historial vigente verificado en el complemento y cierre técnico mantenido,
confirmar historyFile efectivo del backend y referencias coherentes con el principal
según BACKUP_PLAN. Preparar A/B fuera del repositorio solo tras autorización;
los cambios de historial aquí deben limitarse a estas dos rutas sintéticas:

```bash
FIXTURE_ROOT_META_A="$HOME/.local/state/lab-ia-meta-a/acceptance"
WORKSPACE_A_META_A="$FIXTURE_ROOT_META_A/A"
WORKSPACE_B_META_A="$FIXTURE_ROOT_META_A/B"
test ! -e "$FIXTURE_ROOT_META_A"
install -d -m 0700 "$WORKSPACE_A_META_A" "$WORKSPACE_B_META_A"
printf 'Proyecto ficticio para aceptación META A.\n' > "$WORKSPACE_A_META_A/README.md"
printf 'Solo datos sintéticos.\n' > "$WORKSPACE_A_META_A/notas.txt"
printf 'Proyecto ficticio B para aceptación META A.\n' > "$WORKSPACE_B_META_A/README.md"
printf 'Solo datos sintéticos.\n' > "$WORKSPACE_B_META_A/notas.txt"
printf '%s\n' "$WORKSPACE_A_META_A" "$WORKSPACE_B_META_A" >> "$HISTORY_META_A"
"$ROOT_META_A/scripts/lab-open" "$WORKSPACE_A_META_A"
```

Es registro administrativo explícito de dos rutas de prueba, no una ampliación
automática de allowlist por lab-open. Confirmar que el runtime es el mismo del
backend y mantener su entorno relevante al ejecutar el script. Registrar nuevo
ID OpenCode y conservar Gateway ID/StartedAt. Verificar NET-01–08 otra vez.

## Dos invocaciones autorizadas, parser real y backend

`accept_reviewer.py` es un paso independiente, no un script de cutover. Exige
el workspace A exacto y sus dos contenidos sintéticos, aplica tools=false y
permission=deny y usa una sola invocación sin retries manuales:

```bash
python3 "$PKG_META_A/accept_reviewer.py" --run-one-authorized-reviewer
```

Esperado FUN-01: exit 0, parser real PASS, elementos solo README.md/notas.txt,
sin eventos de herramientas/error. Usa la función parseWorkspaceSummary extraída
sin cambios del backend, no un JSON.parse alternativo ni inicio de SQLite.
El CLI tiene timeout 110 s y la llamada externa 120 s; Gateway sigue en 105 s
por request. No hay deadline de 240 s. Si falla, parar; no generar otra inferencia
automáticamente. Los 429 internos recuperables pueden ser aceptables.

FUN-02: correlacionar metadata segura de Gateway con la ventana de la invocación:
todos los streams aceptados deben terminar reason=OK/status=200, con validación
SSE/[DONE] del gateway, sin transporte abortado. HTTP 200 inicial no basta.
No atribuir solicitudes simultáneas no identificadas a retries. No guardar
stdout completo, prompts, respuestas ni contenido de sesiones.

FUN-03: desde la sesión existente de la aplicación, verificar GET de navegador
`/api/lab/api/opencode/status` y `/api/lab/api/workspaces/active`, versión/disponibilidad y
workspace sintético activo. Usar la autenticación existente; no exportar tokens
ni copiarlos a contenedores. Backend mantiene transportes loopback sin cambios.
Para cubrir el recorrido HTTP completo del backend, la autorización futura debe
incluir una segunda y última invocación: pulsar una sola vez «Analizar workspace»
con A activo. El cliente existente envía POST
`/api/lab/api/opencode/workspace-summary`, body `{}`, con cookie y X-Lab-CSRF
gestionados por la aplicación. No fabricar/copiar ese header ni usar curl con
credenciales. Esperado: HTTP 200, success=true, agent=reviewer y summary con
las cuatro claves y solo los dos archivos sintéticos. Por el código real del
backend, ese éxito requiere exit 0 y parseWorkspaceSummary PASS.

Presupuesto propuesto para la futura aceptación: exactamente dos invocaciones
principales (CLI instrumentada y una mediante backend), sin retries manuales.
Si esa segunda inferencia no está autorizada, FUN-03 completo queda pendiente
y no se declara aceptación final. Chat no está incluido ni se prueba por defecto.

## Activación A → B → A y retorno al original

```bash
"$ROOT_META_A/scripts/lab-open" "$WORKSPACE_B_META_A"
"$ROOT_META_A/scripts/lab-open" "$WORKSPACE_A_META_A"
```

Ejecutar por separado. Después de cada uno, aplicar invariantes de 5B.10H.1:
Source real exacto, RO, FRONT exclusiva, provider/HOME, hardening, sin puertos ni
extra_hosts, Gateway ID/StartedAt/mounts normalizados conservados y healthy.
Guardar duración y nuevo ID de OpenCode. Comparar mounts por
Destination/Type/RW/Source ordenados; nunca por orden del array. No aceptar solo
exit 0. Ante un fallo, parar antes del siguiente paso y proceder a rollback.

Restaurar historial original respaldado y workspace original, sin tocar archivos
de ninguno de los proyectos privados. Antes de restaurar, confirmar que no hubo
cambios concurrentes legítimos y que el delta del historial contiene únicamente
las rutas sintéticas autorizadas; no descartar entradas ajenas para forzar PASS.
El complemento ya debía contener la ruta original:

```bash
python3 - "$HISTORY_BACKUP_META_A" "$HISTORY_META_A" <<'PY'
import json,sys,shutil,os,hashlib
from pathlib import Path
h,destination=map(Path,sys.argv[1:])
r=json.loads((h/'references.json').read_text())
v=json.loads((h/'history-verification.json').read_text())
source=h/'config/recent-workspaces'
assert str(destination)==r['historyFile']==v['originalPath']
assert not source.is_symlink() and not destination.is_symlink()
assert hashlib.sha256(source.read_bytes()).hexdigest()==v['sha256']
assert (v['originalUid'],v['originalGid'])==(os.getuid(),os.getgid())
shutil.copyfile(source,destination)
os.chmod(destination,int(v['originalMode'],8))
assert hashlib.sha256(destination.read_bytes()).hexdigest()==v['sha256']
PY
"$ROOT_META_A/scripts/lab-open" "$WORKSPACE_ORIGINAL_META_A"
```

Revalidar invariantes. Los fixtures se
retiran específicamente solo cuando dejaron de estar montados y el cierre fue
aceptado; nunca borrar directorios deducidos sin verificar identidad.

## Persistencia y protección de datos

DAT-01: comparar referencias/mounts de ambos HOME antes/después; el anterior no
se usa para el agente nuevo ni se importa a él. No borrar el estado nuevo para
ocultar anomalías. Clasificar escrituras técnicas esperadas del HOME nuevo,
rechazando credenciales importadas o dependencias descargadas inesperadamente.
DAT-02: workspace original intacto y RO, historial igual al complemento después
de retirar solo las entradas sintéticas autorizadas, volumen/modelos de Ollama
conservados y backend/SQLite sin sustitución ni migración. No exigir hashes
constantes de bases que legítimamente reciben escrituras autorizadas: conciliar
los efectos esperados sin inspeccionar/publicar sesiones o datos privados.
Una discrepancia no explicada bloquea aceptación y exige conservar evidencia.

## Regresión HTTP y recursos

Solo tras éxito funcional y sin peticiones concurrentes, enviar AL GATEWAY:
POST /api/pull, /api/push, /api/chat y GET /api/tags (4 × 404), y POST
/v1/chat/completions con modelo alternativo (400). Nunca contra Ollama.
Ejemplo reproducible desde Node del Gateway, exclusivamente a su IP frontal:

```bash
docker compose -p docker -f "$COMPOSE_META_A" exec -T opencode-gateway node --input-type=module <<'JS'
import http from 'node:http';import os from 'node:os';
const addresses=(os.networkInterfaces().front0??[]).filter(x=>x.family==='IPv4'&&!x.internal);
if(addresses.length!==1)throw Error('FRONT');
for(const [method,path,wanted,body] of [
 ['POST','/api/pull',404,{}],['POST','/api/push',404,{}],['POST','/api/chat',404,{}],
 ['GET','/api/tags',404,null],['POST','/v1/chat/completions',400,{model:'alternative',messages:[{role:'user',content:'Sintético'}]}]]) {
 await new Promise((resolve,reject)=>{
  const q=http.request({hostname:addresses[0].address,port:8080,path,method,agent:false,timeout:3000,headers:{'Content-Type':'application/json'}},r=>{
   r.resume();r.once('end',()=>{console.log(JSON.stringify({method,path,status:r.statusCode}));r.statusCode===wanted?resolve():reject(Error('STATUS'));});
  });q.once('timeout',()=>q.destroy(Error('TIMEOUT')));q.once('error',reject);if(body)q.write(JSON.stringify(body));q.end();
 });
}
JS
docker stats --no-stream opencode "$GATEWAY_ID_META_A" ollama
docker inspect opencode "$GATEWAY_ID_META_A" --format '{{.Name}} OOM={{.State.OOMKilled}} Restarts={{.RestartCount}}'
```

SEC-01: contar registros result=allow del logger seguro antes/después; deben
permanecer iguales durante las cinco denegaciones, con ninguna otra petición
activa. Falta de observabilidad = NO VERIFICADO. No atribuir tráfico externo
que no pueda observarse ni medir bloqueo mediante operaciones peligrosas reales.

Métricas históricas 5B.11A en reposo: WSL disponible 7,47 GiB, backend RSS
76,7 MiB, OpenCode 517,4 MiB y Ollama 106,7 MiB. No son máximos; pico de inferencia
qwen3:8b pendiente. Presupuesto Gateway 256 MiB/0,5 CPU propuesto, sin validación
de carga. Renovar medidas antes de la prueba y aprobar margen, umbrales de parada,
muestreo de pico/swap/OOM/reinicios y duración; no sumar reservas WSL/Docker.
Los umbrales preliminares de 5B.11A requieren aprobación, no garantizan capacidad.
Si falta esa aprobación u observabilidad, NO-GO antes de generar carga.

RES-01: Gateway mantiene Memory=268435456/NanoCpus=500000000, sin OOM/reinicios
y sin presión incompatible en host/VM. Registrar muestras y pico de cgroup con
su intervalo; un pico después de reiniciar no es el pico de toda la intervención.

## Cierre o reversión

Aceptar META A solo si NET, FUN, DAT, activación, SEC y RES están completos y ambas
invocaciones aprobadas terminaron correctamente. Cualquier bypass o cambio
inesperado en Ollama = NO-GO. Una autorización más acotada no habilita a ampliar
el número de inferencias ni a declarar cobertura del backend no ensayada.

Guardar metadata final en evidencia privada nueva y exclusiva, fuera de Git;
no escribir en el principal ni en el complemento históricos. Revisar Git solo en
lectura y comparar Ollama y otras aplicaciones. Reabrir únicamente tras aceptación
completa o rollback verificado y autorización humana expresa; nunca automáticamente. Conservar HOME anterior, backup, volumen e imágenes.
No afirmar egress estricto, DNS cerrado universal, forwarding controlado,
Internet de Ollama aislado ni NIVEL 2 completo. No commit/push sin autorización.
