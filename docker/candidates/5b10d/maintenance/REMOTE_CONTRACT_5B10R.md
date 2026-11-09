# 5B.10R — identidad y terminación remota

PROTOTIPO AISLADO — NO INTEGRADO. HEAD de partida `04e5065`.

## Decisión técnica

**NO FACTIBLE CON EL CONTRATO ACTUAL** para acreditar terminación de cada familia
remota y ausencia de ejecuciones desconocidas. La identidad de un exec mediante
API es viable como diseño; su adopción no resuelve por sí misma descendientes,
procesos persistentes ni exclusión de productores externos. No integrar la barrera
completa, un daemon, un wrapper o un nuevo transporte productivo en esta fase.

Recomendación única: contingencia operativa conservadora. Preparar primero un
gate efectivo, conservar trabajos admitidos, reconciliar evidencia y tratar
cualquier ejecución no clasificable como NO-GO. La parada controlada del backend
solo sería posterior al drenaje acreditado; nunca usarla como sustituto de este.
La contingencia aún no está lista para ejecutarse y no autoriza cutover.

## Contrato productivo observado

Fuentes leídas: index.js (inspectOpenCode, queryOpenCode, runWorkspaceSummary,
parseWorkspaceSummary, runLabOpen), workspace-routes.js y scripts/lab-open.

| Aspecto | Evidencia actual | Límite |
|---|---|---|
| Entrada summary | Snapshot acotado por stdin, prompt fijo, reviewer, --pure, workspace | No usar argv ni logs para capturar contenido |
| Lanzamiento | execFile de docker exec por nombre opencode | El backend no conserva el ID de exec retornado por el Engine |
| Identidad local | Objeto ChildProcess/PID del cliente | No equivale al PID dentro del Engine o namespace del contenedor |
| Contenedor | inspect obtiene running y workspace; otros datos existen en Docker | El resultado de inspectOpenCode no retiene ID/StartedAt para vincular el trabajo |
| Salida | Callback execFile, stdout JSON de eventos, parser real | Resultado funcional no acredita toda la familia remota |
| Límites | timeout remoto 110 s; cliente 120 s y 1 MiB de maxBuffer | SIGKILL al cliente, timeout, retainLock o espera no acreditan fin remoto |
| Activación | spawn del script con una ruta; promesa resuelta en exit | No espera close ni lleva identidad de cada operación Compose/exec del script |
| Script activo | compose up --force-recreate opencode, inspecciones, ls y actualización del historial | Activación cambia generación del contenedor; no es equivalente a un reviewer exec |
| Cancelación | No se observó un vínculo de cancelación HTTP a terminación remota demostrada | Cierre HTTP, error de lectura o abort no prueban terminación |
| Descendientes | Sin registro fiable por trabajo | PPID, nombre, timeout y salida del cliente son insuficientes |

Nada de lo anterior se ejecutó durante esta fase. El script activo tiene un modo
interactivo sin argumentos; el backend utiliza su contrato de un argumento.

## Mecanismos comparados

| Mecanismo | Identidad y terminación | Descendientes, reinicios y timeout | Cambios y riesgo |
|---|---|---|---|
| A. CLI actual | PID/close/exit local y salida; no conserva exec ID | No acredita familia; reinicio invalida inferencias; timeout local incierto | Menor cambio, garantía insuficiente |
| B. Engine API | Crear exec, guardar ID, arrancar e inspeccionar por ID; vincular contenedor/generación | Inspeccionar exec no certifica descendientes; error/404/reinicio siguen inciertos | Adaptador backend de transporte, stdin y framing; riesgo del socket ya privilegiado, sin extenderlo a contenedores |
| C. Wrapper con runId | Correlaciona mensaje de arranque/salida con petición | Declaración cooperativa; un hijo puede escapar o falsificar reporte bajo el mismo UID; caída deja registro incierto | Nuevo archivo remoto RO, protocolo y disponibilidad de runtime a comprobar; no desarrollado |
| D. Grupo de procesos | PGID/sesión ayudan a observar familia cooperativa | setsid puede separar descendientes; PID/PGID reutilizables; no ofrece frontera completa | Herramientas/delegación no verificadas en la imagen; no adoptar ni añadir privilegios |

Docker documenta create/start/inspect como operaciones separadas del exec. Se
consultó la [referencia Engine API v1.53](https://docs.docker.com/reference/api/engine/version/v1.53/).
El Engine instalado declara 29.5.3 y API 1.54; no se probaron operaciones exec en
ninguna versión. Un futuro cliente deberá negociar una versión compatible.
La lectura de esa referencia no demuestra contención de descendientes.

Linux permite a un proceso elegible crear una sesión y grupo nuevos mediante
[setsid(2)](https://man7.org/linux/man-pages/man2/setsid.2.html).
Por eso PGID no constituye por sí solo una frontera de seguimiento exhaustivo.
No se propone cgroup delegado: disponibilidad y permisos no se demostraron y
añadirlo excedería el alcance. No asumir que cap_drop ALL impide setsid.

## Contrato mínimo y estados del prototipo

`remote-run.mjs` utiliza el consumidor de evidencia existente
`remote-termination.mjs`, sin modificarlo. No transporta comandos ni incorpora
admisión, socket administrativo, persistencia, Docker o lógica de mantenimiento.

| Campo | Significado |
|---|---|
| runId | UUID generado localmente; correlación, no credencial ni prueba de autoría |
| containerId, containerStartedAt | ID completo y generación capturados antes del trabajo |
| executionId | ID completo capturado al crear; inmutable, nunca proporcionado por el cliente HTTP |
| state | CREATED, RUNNING, FINISHED_VERIFIED, UNCERTAIN o FAILED |
| createdAt, startedAt | Tiempos locales de registro/observación, no timestamps autoritativos del Engine |
| pid, processStart | Identidad de nacimiento capturada; debe especificarse namespace y fuente en un adaptador real |
| client.exited, client.closed | Eventos del cliente/transportación, separados de la respuesta HTTP |
| verifiedAt, remoteEndedAt | Tiempo local de evidencia y tiempo remoto; este último queda null porque no se conoce |
| result | exitCode de la observación validada; no se guardan stdout, prompts ni respuestas |
| descendants | UNKNOWN o ENDED_BY_TRUSTED_ADAPTER, sin atribuir esa garantía a Docker |
| verification, reason, blocksDrain | Resultado observable y bloqueo conservador |

Secuencia propuesta de un adaptador futuro: registrar runId e intención antes de
crear; capturar ID y persistir antes de start; volver a comprobar generación;
capturar identidad de nacimiento si existe evidencia fiable; conservar cierre del
cliente como recurso propio; consultar de forma independiente ejecución y cobertura
de descendientes; solo entonces verificar. No se implementó ese adaptador.
Si el trabajo termina demasiado rápido para capturar nacimiento fiable, no
inventar el PID ni recuperar identidad por nombre: UNCERTAIN con este consumidor.
Un Pid=0 al terminar no sustituye al PID inicial. No equiparar PID de WSL, Engine
y contenedor sin una traducción demostrada.

- CREATED conserva drenaje bloqueado, incluso antes de obtener exec ID.
- creationAttempted se marca antes de enviar la solicitud de creación. Si se
  pierde la respuesta, podría existir un exec: no se permite declarar FAILED
  como si nada se hubiera creado ni repetir ciegamente creación/start.
- FAILED solo representa rechazo local antes de intentar crear; no hay trabajo
  remoto iniciado. Un exitCode remoto no cero puede estar FINISHED_VERIFIED:
  terminación comprobada y éxito funcional son conceptos distintos.
- Exit, close, timeout, desconexión, cancelación o error nunca verifican solos.
- FINISHED_VERIFIED exige identidad completa, generación igual, exec terminado,
  exitCode entero, proceso raíz ausente/terminado y evidencia confiable de
  descendientes terminados, cobertura completa y cero desconocidos; además exige
  cierre del cliente. El verificador instalado es confiable, no acepta pruebas
  de una petición HTTP. Un booleano complete=true falsificado anula la garantía.
- Un evento concurrente invalida la observación pendiente. La verificación es
  puntual, no una licencia de drenaje indefinida: revalidar bajo exclusividad
  antes de una intervención. No garantiza ausencia global de trabajo nuevo.
- Reinicio del backend no está implementado por este prototipo en memoria. Una
  integración futura debe recuperar registros privados cerrada, reconciliar IDs
  y nunca convertir pérdida de registro o 404 en ausencia de trabajo.

El runId no impide PID reuse, falsificación de un wrapper o ejecuciones externas.
El vínculo con exec y generación es necesario pero no suficiente. La observación
de trabajos externos debe proceder de un inventario independiente y exclusividad
del operador; el registro de trabajos propios no descubre automáticamente todos
los ajenos. El OpenCode persistente existente requiere clasificación independiente.

## Pruebas ejecutadas y alcance

```bash
node --check docker/candidates/5b10d/maintenance/remote-run.mjs
node --check docker/candidates/5b10d/maintenance/remote-run.test.mjs
node --test --test-reporter=spec docker/candidates/5b10d/maintenance/remote-run.test.mjs
```

Node local v22.22.1. Ejecución con casos individuales visibles: **15 PASS, 0 FAIL,
0 SKIPPED, 0 canceladas**, duración **883,141761 ms**. El runner restringido inicial
solo reportó un agregado por archivo; no se usa ese 1 PASS como recuento de casos.

R01 normal con observación independiente; R02 exit antes de close; R03 timeout;
R04 desconexión; R05 descendiente vivo; R06 descendiente terminado; R07 PID reuse;
R08 reinicio del contenedor; R09 exec equivocado; R10 consulta fallida/lenta;
R11 inventario incompleto; R12 ejecución externa desconocida; R13 creación y
respuesta perdida/UUID único; R14 cancelación concurrente y nueva incertidumbre; R15 verificaciones solapadas.

R01/R03/R04 usan procesos Node reales sintéticos; R05/R06 lanzan desde el padre un
descendiente Node con detached=true, stdio independiente, que sobrevive al padre.
Se observa nacimiento/terminación real en /proc de ese entorno de ensayo. Los
IDs de contenedor/exec y la API son mocks. La cobertura completa de descendientes
solo se conoce por el código controlado de la fixture; NO es una propiedad medida
de Docker ni de OpenCode real. Los casos de PID reuse, reinicio, consultas y
desconocidos son observaciones simuladas. R04 usa un evento de desconexión simulado,
sin servidor HTTP. No se ejercitan handlers productivos ni el parser de summary.

Las fixtures viven en directorios exclusivos /tmp/labia-5b10r-*, sin HOME ni
credenciales; solo lanzan Node con los archivos que crean. Cleanup específico
espera el cierre y termina únicamente procesos sintéticos propios comprobando
su identidad de nacimiento; no hay kill por nombre ni limpieza Docker. Todos los
directorios/procesos propios desaparecieron. No hubo listener HTTP/Unix de prueba,
SQLite, descargas ni Docker/Ollama desde las pruebas.

## Compatibilidad, coste y contingencia

Un futuro adaptador tocaría index.js/runWorkspaceSummary y un módulo local nuevo;
preservaría contratos HTTP, parser, modelo qwen3:8b, reviewer sin herramientas,
110 s remoto, 120 s de cliente y Gateway 105 s. La API requiere tratamiento de
stream/stdin/framing y límites de salida; no se asume compatible sin probarlo.
El launcher de Gateway, aislamiento frontal y workspace RO no necesitan cambios
por identidad del exec. Tampoco Ollama, sus modelos, Compose ni nuevos privilegios.
lab-open conserva un argumento y requiere prueba separada de sus efectos Compose;
no se convierte silenciosamente en wrapper de inferencia.

Coste del registro/API: moderado. Coste de demostrar descendientes y exclusividad:
alto/no resuelto en el entorno actual. Wrapper/grupo por sí solos no lo reducen
a una garantía suficiente. No merece incorporar ahora más piezas de mantenimiento.

Contingencia: gate técnico demostrado, registro de admitidos/hijos/diferidos,
exclusión de productores externos, reconciliación y cierre de trabajo conocido.
Cualquier identidad, transporte o proceso desconocido mantiene NO-GO; no matar,
reiniciar ni recrear contenedores para ocultarlo. Solo después se consideraría
parar controladamente el backend con autorización y control de relanzamiento.

Runbooks necesitan únicamente añadir estas puertas de evidencia y el rechazo de
create/start inciertos a las correcciones ya candidatas, conservando ambos backups,
HOME preparado, rollback y reapertura explícita. promotion/ no fue modificado.
Retirar un futuro adaptador exige reconciliar trabajos antes de restaurar código;
conservar registros pendientes, no borrarlos al hacer rollback. No se ejecutó nada
de ese procedimiento. Memoria de inferencia, egress, DNS y forwarding siguen
pendientes; no se declara NIVEL 2 ni compatibilidad universal de agentes.

## Validación final

Baseline Docker registrado por snapshot.py de solo lectura y comparación en
memoria. Backend conserva la identidad operativa y marca de inicio verificadas
localmente, con listener en 127.0.0.1:3001.
Hashes canónicos del HOME preparado y ambos respaldos coinciden con los conocidos;
HOME anterior solo metadata de raíz/mount, sin leer sesiones o autenticación.
Los archivos productivos, barrera previa, promotion/ y respaldos no se modificaron.

Archivos añadidos únicamente: remote-run.mjs, remote-run.test.mjs y este documento.
Fase de diseño/prototipo completada; NO-GO para integración productiva/cutover.
Siguiente paso mínimo: revisar y autorizar el gate de admisión aislado, manteniendo
la puerta de inventario remoto cerrada hasta contar con evidencia suficiente.
