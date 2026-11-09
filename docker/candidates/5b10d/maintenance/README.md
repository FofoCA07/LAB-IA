# Barrera candidata — PREPARADA, NO INTEGRADA

FASE 5B.10M. Solo este directorio es nuevo. No se ha iniciado mantenimiento real,
ni alterado el puerto 3001, el backend, Docker, HOME o backups privados.
META A sigue sin autorizarse; esta barrera no implementa aislamiento de red.

## Archivos y ejecución local

- `barrier.mjs`: admisión, recursos pendientes, drenaje y recuperación.
- `private-store.mjs`: checkpoint privado y exclusión de una instancia.
- `local-control.mjs`: servidor de control exclusivamente Unix, sin autoarranque.
- `barrier.test.mjs`: pruebas con eventos simulados, disco y sockets Unix locales.
- `INTEGRATION_PLAN.md`: puntos futuros de integración y evidencias pendientes.
- `RUNBOOK_CORRECTIONS.md` y `.diff`: propuesta NO APLICADA para promoción.

Desde la raíz del repositorio:

```bash
node --test docker/candidates/5b10d/maintenance/barrier.test.mjs
node --check docker/candidates/5b10d/maintenance/barrier.mjs
node --check docker/candidates/5b10d/maintenance/private-store.mjs
node --check docker/candidates/5b10d/maintenance/local-control.mjs
```

Las fixtures se crean únicamente como `.test-*` dentro de este directorio, con
limpieza específica mediante hooks de tests. No se ejecuta Docker ni se importa
el backend. Los procesos hijos se simulan con EventEmitter; esto no prueba aún
los hooks reales de execFile/spawn. Los sockets son temporales, no el socket de
una instancia real. Ejecutar necesita permiso para sockets Unix locales.

Resultado ejecutado en 5B.10M: 33/33 PASS con Node local v22.22.1. Incluye T01–T16
y regresiones adicionales de recursos remotos, persistencia, control y fallos.
La ejecución restringida inicialmente bloqueó sockets Unix con EPERM; la ejecución
local autorizada los probó sin TCP ni servicios productivos. No es una prueba
del backend integrado ni de la imagen Node del futuro Gateway.

## Estados y contrato

| Estado | Admisión cotidiana | Condición |
|---|---|---|
| NORMAL | Permitida | Solo después de recuperación y reapertura explícitas |
| DRAINING | Cerrada | Puede haber trabajos o pruebas administrativas activos |
| MAINTENANCE | Cerrada | Confirmación explícita sin trabajos, incertidumbres ni fallos |

Cada arranque exige `recover()` con un verificador confiable; por defecto devuelve
false. Un checkpoint MAINTENANCE permanece cerrado; uno NORMAL vuelve DRAINING.
Incluso un primer arranque vacío requiere reconciliación. No hay apertura por
timeout, reinicio, caída de socket o cancelación de espera.

`admit(kind)` comprueba y registra sin await, y persiste antes de devolver el
ticket. Solo se aceptan tipos enumerados, nunca prompts, rutas, mensajes o IDs
de conversaciones. La operación admite recursos `process`, `remote`, `deferred`
y `promise` con `hold()`. El ticket raíz y todos los recursos deben finalizar;
`finish()` es idempotente. Registrar cada continuación ANTES de programarla.
En 5B.10N se permite adquirir subrecursos tras el fin raíz únicamente si ya hay
una reserva pendiente del mismo trabajo; nunca se resucita un trabajo terminado.
Esto permite seguir una continuación admitida cuando ya terminó HTTP. La raíz se termina en finally
al acabar el handler real, nunca en response.close ni por Promise.race solamente.

`drain()` cierra la admisión de forma síncrona. `waitForDrain()` espera y devuelve
metadata; no cambia a MAINTENANCE. `confirm()` hace esa transición explícita.
`reopen()` solo admite desde MAINTENANCE sin recuperación pendiente ni trabajos.
Un fallo al persistir deja DRAINING/fault=PERSISTENCE_FAILED y bloquea reapertura.

`trackChild()` registra antes de retornar al event loop y espera `close`, no
`exit`. Un evento error marca incertidumbre. Los clientes Docker y shell requieren
`remote: true` y un verificador real de terminación del trabajo remoto/descendientes.
El cierre del cliente no libera el recurso remoto por defecto. Si la primera
verificación falla, `verifyRemoteCompletion()` permite repetir exclusivamente la
misma comprobación confiable después del cierre; no relanza trabajo. Una marca
TIMEOUT/UNCERTAIN exige además `reconcileJob()` con el verificador instalado.
No existe una orden administrativa para forzar el contador a cero.

Los verificadores son código de integración confiable. Un callback que devuelva
true sin evidencia ANULA la garantía. Los tests usan pruebas simuladas, no
certifican ausencia de procesos reales de OpenCode/Ollama.

## Persistencia y recuperación

Un futuro directorio dedicado, por ejemplo bajo el runtime privado del backend,
debe ser absoluto, sin symlinks, propiedad del operador y 0700. No se crea aquí.
Estado 0600, archivo temporal exclusivo, fsync, rename y fsync del directorio;
un owner.lock exclusivo impide dos coordinadores sobre el mismo checkpoint.
Solo se almacenan estado, secuencia e ID/tipo de trabajos. Un registro pendiente
se recupera como incierto: tras una caída no se da por terminado.

No se borran locks stale, estados corruptos ni sockets existentes automáticamente.
Recuperación futura: mantener admisión cerrada; comprobar PID más identidad de
inicio, ausencia de otro backend y trabajo remoto/descendientes; conservar copia
privada del checkpoint; retirar SOLO el lock/socket stale identificado con
autorización del operador. Después arrancar cerrado y ejecutar el verificador
confiable. Si no hay prueba de ausencia, no abrir. No reiniciar Ollama ni borrar
HOME, volúmenes o registros para aparentar drenaje.

El adaptador futuro de SIGTERM debe llamar drain primero, esperar recursos reales
y persistir pendientes si agota su plazo. No debe eliminar estado ni matar un
grupo de procesos ajeno. `close()` conserva DRAINING y trabajos, libera su propio
lock y despierta esperas con DISPOSED; no termina procesos por sí mismo.

## Control local y diagnóstico

`openLocalControl` no se llama al importar el módulo. Requiere directorio privado
0700; crea solo `control.sock`, chmod 0600, no TCP. No reutiliza sockets existentes.
Recibe una línea JSON acotada a 1024 bytes, máximo cuatro clientes, timeout de
inactividad 2 s. Autoriza cada comando mediante callback, por defecto DENY.
Comandos: status, drain, confirm, reopen, recover y diagnostic con un tipo enumerado.
recover ejecuta únicamente el verificador instalado, sin aceptar pruebas del cliente.
No hay exec, comandos shell, rutas arbitrarias, tokens en URL ni cambios HTTP.

El permiso de filesystem representa confianza en TODO el UID propietario; no
distingue humanos o procesos de ese mismo UID. Node aquí no autentica por sí solo
un operador independiente ni verifica credenciales del peer. No usar un simple
`authorize: () => true` como prueba de identidad: en una futura integración solo
sería aceptable declarar explícitamente el UID completo como frontera de confianza.
Si se exige distinguir operadores con el mismo UID, queda NO-GO hasta otro diseño.

Las pruebas administrativas usan callbacks fijos registrados por la integración,
sin habilitar rutas HTTP ni saltarse autenticación/CSRF existentes. Una prueba
solo se inicia desde MAINTENANCE recuperado, pasa a DRAINING y vuelve a requerir
confirmación al terminar. La admisión cotidiana sigue cerrada. No retorna contenido
del callback. Desconectar el cliente o agotar su socket no cancela ni libera el
diagnóstico; consultar status por otra conexión. Cada callback debe conservar
sus deadlines reales y recursos rastreados. La pérdida/cierre del servidor de
control cierra la admisión; borrar el pathname desde fuera puede no generar un
evento del servidor y requiere vigilancia/operación exclusiva futura.

## Garantías y pendientes

Comprobado en tests locales: máquina y admisión atómica en un único proceso/event loop,
registro conservador, persistencia, exclusión local y protocolo Unix acotado.
No probado todavía: integración con backend, verificación remota, recepción de
señales reales, múltiples workers, clientes Docker externos o drenaje global.
Ni un listado instantáneo de procesos ni `active:0` bloquean CLI ajenas.
El operador debe controlar UI/CLI externas y comprobar todos los backends vivos.

La memoria de inferencia qwen3:8b sigue sin medirse. Gateway conserva 256 MiB y
0,5 CPU. Los mínimos preliminares de 2 GiB Windows/1 GiB WSL no acreditan capacidad
para cargar el modelo ni se suman como reservas independientes. Una fase futura
autorizada medirá disponibles antes/durante, pico de cgroup y del host, swap y
paginación, OOMKilled, reinicios, latencia de servicios y reviewer 110 s /
execFile 120 s / Gateway 105 s. No usar el deadline experimental de 240 s.

## Ensamblaje posterior 5B.10O

Ver ASSEMBLY_FINDINGS.md: se ensayó el wiring de index copiado en un VM con
dependencias peligrosas sustituidas y efectos confinados a fixtures. Nuevos
archivos: ASSEMBLY_SOURCES.json, isolated-assembly.mjs, remote-termination.mjs y
assembly-remote.test.mjs. Se ejecutaron 12/12 pruebas nuevas más 64/64 previas.
No es integración productiva ni E2E con Docker/Ollama reales.

La terminación remota individual sigue NO VERIFICABLE con el contrato CLI actual.
El consumidor de pruebas candidato exige identidad que hoy no se conserva y no
incluye adaptador Docker. Recomendación actual: estudiar una ventana operativa
separada para META A; no promover esta barrera sin resolver sus bloqueadores.
