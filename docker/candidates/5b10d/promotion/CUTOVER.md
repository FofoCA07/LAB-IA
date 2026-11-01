# Cutover META A — PREPARADO — NO EJECUTADO

Requiere autorización explícita futura. Ejecutar bloques de uno en uno, con
revisión entre puertas. No pegar este documento como script integral.

## A–E: preflight, respaldo, archivos nuevos, HOME y esquema

Completar README y BACKUP_PLAN. Definir variables en cada terminal nueva:

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
cd "$ROOT_META_A"
WORKSPACE_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
export LAB_WORKSPACE="$WORKSPACE_META_A"
export LAB_OPENCODE_HOME="$NEW_HOME_META_A"
```

No reutilizar un HOME nuevo ya existente sin revisión; el helper no lo sobrescribe.
Preparar solo el cierre auditado; este paso no inicia servicios:

```bash
python3 "$PKG_META_A/prepare_home.py" --prepare-new-home
test -d "$NEW_HOME_META_A"
test "$(stat -c %u:%g "$NEW_HOME_META_A")" = 1000:1000
test "$(stat -c %a "$NEW_HOME_META_A")" = 700
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" config --quiet
```

Revisar config efectiva como en test_package.py: mounts finales sin candidates,
FRONT exclusiva, puertos ausentes, solo HOME RW, dos redes en Gateway y ninguna
definición de Ollama. No confundir parser PASS con red runtime validada.

Instalar únicamente el archivo nuevo, que no está montado por producción:

```bash
test ! -e "$ROOT_META_A/docker/gateway-launcher.mjs"
install -m 0644 "$PKG_META_A/files/docker/gateway-launcher.mjs" "$ROOT_META_A/docker/gateway-launcher.mjs"
cmp "$PKG_META_A/files/docker/gateway-launcher.mjs" "$ROOT_META_A/docker/gateway-launcher.mjs"
```

Si el path ya existe, parar y reconciliar su identidad; no sobrescribirlo.
La configuración OpenCode y el Compose activos siguen intactos en esta etapa.

## F–G: preparar Gateway sin recrear OpenCode

Precondiciones: no colisiones en docker_front/docker_upstream ni servicio
opencode-gateway, imágenes exactas locales, HOME preparado, respaldo válido.

```bash
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" up -d --no-deps --pull never --no-build --wait --wait-timeout 45 opencode-gateway
docker network inspect docker_front docker_upstream
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" ps opencode-gateway
```

Esperado: solo servicio nuevo; FRONT internal/isolated/IPv6=false y UPSTREAM
bridge dedicado. Registrar IDs nuevos. Revisar ambas interfaces, socket real
solo FRONT_IP:8080, healthcheck y ausencia de puertos. Comparar opencode y ollama
con metadata-before.json: ambos aún deben estar intactos. Nunca usar up sin
servicio, --remove-orphans, down o cambios de redes existentes.

GET administrativos desde el namespace Gateway, separados de su API restringida:

```bash
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" exec -T opencode-gateway node --input-type=module <<'JS'
import http from 'node:http';
for (const path of ['/api/version','/api/tags']) {
  await new Promise((resolve,reject)=>{
    const request=http.get({hostname:'host.docker.internal',port:11434,path,agent:false,timeout:5000},response=>{
      let body='';response.on('data',part=>{body+=part;if(body.length>1048576)request.destroy(new Error('SIZE'));});
      response.once('error',reject);response.once('end',()=>{
        try {if(response.statusCode!==200)throw Error('STATUS');const value=JSON.parse(body);
          const metadata={method:'GET',path,status:response.statusCode};
          if(path==='/api/version')metadata.version=value.version;
          else {metadata.qwen3_8b=(value.models??[]).some(model=>(model.name??model.model)==='qwen3:8b');if(!metadata.qwen3_8b)throw Error('MODEL_MISSING');}
          console.log(JSON.stringify(metadata));resolve();
        }catch(error){reject(error);}
      });
    });request.once('timeout',()=>request.destroy(Error('TIMEOUT')));request.once('error',reject);
  });
}
JS
```

Esperado: dos 200 y modelo presente. No inferencia, rutas alternativas ni cambio
automático a una IP si falla. Ante fallo: retirar solo recursos nuevos según
rollback previo al cutover; OpenCode continúa con configuración anterior.

## H–K: drenaje, parada y activación — interrupción de OpenCode

Garantizar ventana exclusiva del backend/UI/CLI. Esperar trabajos activos;
inspeccionar nombres de procesos sin imprimir argv/prompts:

```bash
docker top opencode -eo pid,comm
```

Este listado por sí solo NO demuestra que no haya solicitudes pendientes en
el backend. Exigir confirmación operativa de drenaje; si no es posible, NO-GO.
No matar procesos ajenos ni usar pkill. Registrar que comienza la interrupción.

```bash
docker compose -p docker -f "$COMPOSE_META_A" stop opencode
docker inspect opencode --format '{{.State.Status}}'
```

Solo si está detenido, sustituir activos (backups ya verificados). Primero las
configuraciones; script cotidiano al final, para no activar rutas a medias:

```bash
install -m 0644 "$PKG_META_A/files/docker/opencode.json" "$ROOT_META_A/docker/opencode.json"
install -m 0644 "$PKG_META_A/files/docker/docker-compose.yml" "$ROOT_META_A/docker/docker-compose.yml"
install -m 0755 "$PKG_META_A/files/scripts/lab-open" "$ROOT_META_A/scripts/lab-open"
cmp "$PKG_META_A/files/docker/opencode.json" "$ROOT_META_A/docker/opencode.json"
cmp "$PKG_META_A/files/docker/docker-compose.yml" "$ROOT_META_A/docker/docker-compose.yml"
cmp "$PKG_META_A/files/scripts/lab-open" "$ROOT_META_A/scripts/lab-open"
docker compose -p docker -f "$COMPOSE_META_A" config --quiet
docker compose -p docker -f "$COMPOSE_META_A" up -d --no-deps --force-recreate --pull never --no-build opencode
```

Se espera nuevo ID/StartedAt solo para OpenCode. Gateway debe conservar los
suyos; Ollama y otras aplicaciones deben coincidir con baseline. No cambiar
timeouts, concurrencia ni privilegios para superar una prueba.

## L–P: aceptación, observación y cierre

Mantener bloqueadas nuevas peticiones de otros clientes. Ejecutar ACCEPTANCE.md
por sus puertas: aislamiento primero, luego las dos invocaciones sintéticas
propuestas (CLI observada y API backend), cada una con autorización local
explícita, parser/SSE, cambio A→B→A y retorno al workspace original.
Sin retries manuales si una inferencia falla. No usar lab-open para
instalar infraestructura ni realizar este primer cutover.

Observar recursos y logs sanitizados, comparar Ollama y otras aplicaciones,
verificar Git/diff y documentar resultado. No autorizar commit/push implícitamente.
Reabrir servicio solo con todos los criterios PASS y responsable de aceptación.
Ante fallo, conservar evidencias sanitizadas y ejecutar ROLLBACK_PRODUCTION.md.
