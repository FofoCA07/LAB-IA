# Cutover META A — RECONCILIADO 5B.11B — NO EJECUTAR

**OPCIÓN B — NO-GO PRODUCTIVO.** Corrección documental, no autorización.
Las puertas B y C no están acreditadas. No aplicar GATE_INTEGRATION.patch ni la
variante 5B.10U; barrera completa no autorizada. Ninguna aprobación con mocks
habilita producción. Ejecutar etapas futuras solo con autorización expresa,
una por una y con revisión humana; no pegar este documento como script integral.

## A. Preflight y autorización humana — sin interrupción

Identificar responsable, alcance, hora, puntos de parada y autorización separada
para startup/warmup, aceptación e inferencias. Revisar README y BACKUP_PLAN.
Exigir paquete íntegro con manifiestos actualizados mediante autorización
separada: 5B.11B modifica documentos y deja los manifiestos históricos intactos.
Mientras el verificador falle, NO-GO; no saltarlo ni regenerar hashes automáticamente.

```bash
ROOT_META_A=$(git rev-parse --show-toplevel)
PKG_META_A="$ROOT_META_A/docker/candidates/5b10d/promotion"
COMPOSE_META_A="$ROOT_META_A/docker/docker-compose.yml"
STAGED_COMPOSE_META_A="$PKG_META_A/files/docker/docker-compose.yml"
NEW_HOME_META_A="$HOME/.local/share/lab-ia-opencode/home-meta-a"
IFS= read -r -p 'Directorio absoluto del principal verificado: ' BACKUP_META_A
IFS= read -r -p 'Directorio absoluto del complemento del historial: ' HISTORY_BACKUP_META_A
cd "$ROOT_META_A"
git status --short --untracked-files=all
git diff --check
python3 "$PKG_META_A/verify_package.py"
```

Aplicar la verificación completa de BACKUP_PLAN, ambas fuentes por separado.
Conservarlas inmutables. Si producción cambió legítimamente, no avanzar sin una
copia fresca autorizada; no seleccionar un backup por fecha sin revisar su alcance.

### HOME existente: validar, no recrear

El HOME sanitizado ya existe. NO ejecutar prepare_home.py --prepare-new-home,
no sobrescribir ni regenerar paquetes. Verificar sin ejecutar OpenCode:

```bash
test -d "$NEW_HOME_META_A"
test ! -L "$NEW_HOME_META_A"
test "$(stat -c %u:%g "$NEW_HOME_META_A")" = 1000:1000
test "$(stat -c %a "$NEW_HOME_META_A")" = 700
WORKSPACE_META_A=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workspace"])' "$BACKUP_META_A/references.json")
export LAB_WORKSPACE="$WORKSPACE_META_A"
export LAB_OPENCODE_HOME="$NEW_HOME_META_A"
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" config --quiet
```

Los tres stat/test no bastan: revisar ancestros sin symlinks, propietarios y modos
restrictivos de todo el árbol, referencias y ausencia de enlaces externos. Comparar
contenido/permisos con el inventario privado de preparación y HOME_INVENTORY.json;
exigir los 27 paquetes auditados, versiones, dependencias y resoluciones locales
compatibles, sin instalaciones/imports con efectos. Inspeccionar solamente archivos
técnicos autorizados, sin publicar datos. Rechazar auth, sesiones, SQLite, tokens,
logs privados o paquetes inesperados. 7 paquetes tienen SRI contrastado; 20 solo
versiones/hashes locales. Un cambio no explicado es NO-GO, no motivo para copiar
el HOME anterior. Conservar ambos HOME físicamente intactos.

Revisar configuración efectiva: proyecto docker, OpenCode solo FRONT, sin
extra_hosts/puertos, workspace RO, HOME dedicado, configuración/agentes RO;
Gateway FRONT+UPSTREAM, front0/upstream0, IPv6=false, FRONT internal+isolated,
listener frontal exclusivo, modelo y timeouts originales. Ollama no se redefine.
Imágenes por digest ya locales, sin pull/build. Verificar colisiones de archivos,
servicios y redes; no modificar docker_default ni otras redes compartidas.

Recursos históricos 5B.11A, en reposo: WSL disponible 7,47 GiB; backend RSS
76,7 MiB; OpenCode 517,4 MiB; Ollama 106,7 MiB. No son máximos ni prueba de
capacidad. Pico qwen3:8b pendiente. Gateway: 256 MiB y 0,5 CPU propuestos.
Antes de una inferencia autorizada renovar métricas, aprobar margen/umbrales y
monitorización; no sumar reservas WSL/Docker ni deducir capacidad de Ollama inactivo.
Si no puede acreditarse un ensayo acotado seguro, detenerse antes de inferencia.

## B. Cierre efectivo de admisiones — puerta actualmente NO-GO

Demostrar rechazo técnico de nuevas operaciones desde frontend y 3001 directo,
clientes existentes, terminales y productores externos. Conservar autenticación
y validaciones. Cerrar Vite o avisar a usuarios no basta. Identificar cómo se
mantendrá el cierre durante aceptación administrativa, rollback y reapertura.
No hay un gate productivo aprobado; este documento no inventa uno ni autoriza
instalar los experimentos rechazados. Si no existe evidencia reproducible de
cierre de todas las vías relevantes, detener aquí sin modificar servicios.

## C. Conciliación de operaciones y procesos — puerta actualmente NO-GO

Con admisión cerrada, conciliar summary, activación, chat, acciones/propuestas,
aplicación, continuaciones reservadas, warmup, hijos locales y ejecuciones
externas. Exigir identidad/generación del contenedor y alcance suficiente del
inventario remoto, incluyendo desconocidos relevantes. Registrar pruebas de
finalización o de compatibilidad con la intervención, no solo ausencia de nombres.

Una espera arbitraria, fin HTTP, exit/close del cliente Docker, timeout o un
listado docker top no acreditan drenaje completo. La parada del backend tampoco.
Incógnitas relevantes, inventario parcial, trabajo persistente o vencimiento del
plazo diagnóstico acordado: NO-GO, conservar evidencia, no matar procesos ajenos
ni recrear contenedores para ocultar incertidumbre.

## D. Parada controlada del backend — comienza la interrupción

Solo tras B y C PASS y autorización humana vigente. Actualmente se inicia mediante
npm run server desde una terminal. Identificar proceso, marca de inicio, padres,
listener 127.0.0.1:3001 y mecanismo real de arranque; no usar PID histórico.
La ausencia de supervisor visible no descarta relanzadores externos. Confirmar
control de terminal/supervisor/tareas externas y un procedimiento concreto de
parada y arranque antes de actuar. Si no puede confirmarse, NO-GO.

El operador detendrá el backend por ese mecanismo previamente verificado;
no se prescribe matar un PID ni se supone que una señal garantiza terminación.
Comprobar proceso y listener cerrados, hijos conciliados y ausencia de
relanzamiento bajo control efectivo durante toda la ventana. No basta observar
un instante sin listener ni esperar unos segundos. No parar Ollama. Conservar
SQLite y estado del backend. Si reaparece una generación no autorizada, detener
la intervención y no tocar OpenCode.

## E. Aplicar candidato — backend detenido y admisión retenida

Revalidar respaldos, HOME, recursos, ausencia de trabajo incompatible y colisiones.
Solo ahora se permite preparar Gateway en una futura fase autorizada. Instalar
el único archivo nuevo, sin tocar aún Compose/provider/lab-open activos:

```bash
test ! -e "$ROOT_META_A/docker/gateway-launcher.mjs"
install -m 0644 "$PKG_META_A/files/docker/gateway-launcher.mjs" "$ROOT_META_A/docker/gateway-launcher.mjs"
cmp "$PKG_META_A/files/docker/gateway-launcher.mjs" "$ROOT_META_A/docker/gateway-launcher.mjs"
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$STAGED_COMPOSE_META_A" up -d --no-deps --pull never --no-build --wait --wait-timeout 45 opencode-gateway
```

Registrar privadamente IDs de los recursos creados. Validar healthcheck, ambas
interfaces, socket solo FRONT_IP:8080, ninguna escucha upstream/wildcard/IPv6,
redes y ausencia de puertos. Verificar Gateway frontal y GET administrativos
/api/version y /api/tags hacia Ollama desde Gateway, sin generación ni rutas
peligrosas. Exigir HTTP 200 y qwen3:8b presente, sin fallback. La healthcheck local
no demuestra por sí sola acceso a Ollama. Si falta un cliente de prueba revisado,
no improvisar transportes: NO VERIFICADO y parar. OpenCode/Ollama deben coincidir
con baseline hasta esta puerta. Fallo: caso 1 de rollback; no continuar al cutover.

Tras Gateway validado y autorización de interrupción de OpenCode:

```bash
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$COMPOSE_META_A" stop opencode
docker inspect opencode --format '{{.State.Status}}'
```

Exigir stopped/exited, sin efectos pendientes incompatibles. Sustituir los tres
archivos solo con OpenCode detenido, dejando lab-open al final:

```bash
install -m 0644 "$PKG_META_A/files/docker/opencode.json" "$ROOT_META_A/docker/opencode.json"
install -m 0644 "$PKG_META_A/files/docker/docker-compose.yml" "$ROOT_META_A/docker/docker-compose.yml"
install -m 0755 "$PKG_META_A/files/scripts/lab-open" "$ROOT_META_A/scripts/lab-open"
cmp "$PKG_META_A/files/docker/opencode.json" "$ROOT_META_A/docker/opencode.json"
cmp "$PKG_META_A/files/docker/docker-compose.yml" "$ROOT_META_A/docker/docker-compose.yml"
cmp "$PKG_META_A/files/scripts/lab-open" "$ROOT_META_A/scripts/lab-open"
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$COMPOSE_META_A" config --quiet
docker compose --project-directory "$ROOT_META_A/docker" -p docker -f "$COMPOSE_META_A" up -d --no-deps --force-recreate --pull never --no-build opencode
```

Solo OpenCode cambia ID/StartedAt; Gateway debe conservarlos. Ollama, sus modelos,
volumen, loopback y las demás aplicaciones permanecen intactos. No up sin servicio,
remove-orphans, down, prune ni cambios de redes compartidas. No relajar hardening,
concurrencia, modelo o timeouts para conseguir PASS.

## F. Aceptación funcional — exclusividad mantenida

Aplicar ACCEPTANCE por puertas: estructura/aislamiento, disponibilidad, HTTP/SSE,
reviewer/parser, persistencia, recursos, activación A→B→A y recuperación del
workspace original. Los ensayos temporales no son aceptación productiva.

CLI y acceso real a Ollama requieren autorización y recursos propios. Para probar
el backend es necesario su arranque controlado y warmup autorizado, manteniendo
el cierre técnico a terceros. Si ese cierre no puede mantenerse con backend
arrancado, NO-GO; no abrir servicio general para comprobarlo. No cambiar auth,
cookies o CSRF. Dos invocaciones principales propuestas requieren autorización
explícita; startup/warmup se consideran carga adicional. No retries manuales.

## G. Rollback o reapertura autorizada

Cualquier bypass, listener upstream, pérdida de isolated, mount privado,
cambio inesperado en Ollama, OOM, stream fallido no recuperado o condición
crítica NO VERIFICADA implica detener y decidir rollback según su runbook.
Primero conservar evidencia sanitizada en un registro privado nuevo; nunca
modificar respaldos históricos ni borrar incertidumbres. Un rollback que afecte
recursos activos exige conciliarlos antes; no continuar destruyendo ante fallo.

Solo después de aceptación completa o rollback verificado, comprobación de
servicios/datos y autorización explícita podrá reabrirse el servicio general.
El arranque administrativo del backend no equivale a reapertura. No reabrir
mediante finally automático. Git lo administra el usuario; este procedimiento
no autoriza staging, commit ni push. NIVEL 2 no declarado.
