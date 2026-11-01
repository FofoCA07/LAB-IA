# Aceptación productiva futura — PREPARADO — NO EJECUTADO

Puerta previa: CUTOVER completado hasta OpenCode nuevo, ventana exclusiva,
baseline/respaldo legibles, permiso para los GET y la única inferencia sintética.
Cada criterio debe tener ID, esperado, observado y PASS/FAIL. Un criterio sin
evidencia se registra NO VERIFICADO y bloquea aceptación. No ampliar límites.

## Variables e invariantes de red antes del reviewer

```bash
ROOT_META_A=/home/adolf/LAB-IA
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
COMPOSE_META_A="$ROOT_META_A/docker/docker-compose.yml"
NEW_HOME_META_A="$HOME/.local/share/lab-ia-opencode/home-meta-a"
IFS= read -r -p 'Ruta absoluta del respaldo verificado: ' BACKUP_META_A
test -d "$BACKUP_META_A"
WORKSPACE_ORIGINAL_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
HISTORY_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["historyFile"])' "$BACKUP_META_A/references.json")
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

Con historial respaldado y ventana exclusiva, preparar A/B fuera del repositorio:

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

## Reviewer único, parser real y backend

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
de ninguno de los proyectos privados:

```bash
cp -p -- "$BACKUP_META_A/config/recent-workspaces" "$HISTORY_META_A"
"$ROOT_META_A/scripts/lab-open" "$WORKSPACE_ORIGINAL_META_A"
```

El respaldo ya debía contener esa ruta. Revalidar invariantes. Los fixtures se
retiran específicamente solo cuando dejaron de estar montados y el cierre fue
aceptado; nunca borrar directorios deducidos sin verificar identidad.

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

RES-01: Gateway mantiene Memory=268435456/NanoCpus=500000000, sin OOM/reinicios
y sin presión incompatible en host/VM. Registrar muestras y pico de cgroup con
su intervalo; un pico después de reiniciar no es el pico de toda la intervención.

## Cierre o reversión

Aceptar META A solo si NET, FUN, activación, SEC y RES están completos y ambas
invocaciones aprobadas terminaron correctamente. Cualquier bypass o cambio
inesperado en Ollama = NO-GO. Una autorización más acotada no habilita a ampliar
el número de inferencias ni a declarar cobertura del backend no ensayada.

Guardar metadata final en el backup privado, revisar Git/diff y comparar Ollama
y otras aplicaciones. Conservar HOME anterior, backup, volumen e imágenes.
No afirmar egress estricto, DNS cerrado universal, forwarding controlado,
Internet de Ollama aislado ni NIVEL 2 completo. No commit/push sin autorización.
