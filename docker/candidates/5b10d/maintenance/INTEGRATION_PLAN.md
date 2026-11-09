# Integración propuesta — NO APLICADA

## Auditoría de entrypoints y efectos

| Archivo/ruta actual | Trabajo y punto de admisión futuro | Liberación/evidencia |
|---|---|---|
| workspace-routes.js, POST /api/opencode/workspace-summary | summary antes de getOpenCodeStatus, debug agent, snapshot y reviewer, después de guard/body validados | Handler, archivos abiertos y proceso remoto realmente terminados |
| workspace-routes.js, POST /api/workspaces/activate | activation antes de locks/stat/lab-open | Script y sus descendientes Docker/Compose terminados; mounts verificados |
| chat-routes.js, POST /api/conversations | write antes de insertar SQLite | Transacción terminada |
| chat-routes.js, POST /api/conversations/:id/messages | write antes de addUserMessage | Transacción SQLite síncrona terminada; hoy no genera inferencia |
| chat-routes.js, POST /api/conversations/:id/respond | chat antes de leer/generar/persistir | Fetch/body y persistencia terminados |
| actions.js, POST /api/actions/decision | action antes de store.decide y onDecision | Lectura autorizada, decisión y recurso de continuación |
| chat-read-continuation.js, notifyDecision | hold(deferred) ANTES de setImmediate; incluir continuación ya reclamada | continueTurn y persistAssistant terminados, incluso tras HTTP cerrado |
| proposal-security.js + change-proposal.js, POST /api/opencode/change-proposal | proposal antes de warmup/estado/locks/catálogo y fases | Operaciones subyacentes, Git y fetch terminados; no solo beforeDeadline |
| proposal-security.js + apply-change-proposal.js, POST /api/opencode/apply-change-proposal | apply antes de claim y escritura Git | Git, auditoría y limpieza reales completas |
| index.js + ollama-warmup.js, startup/start/ensureReady | warmup propio, compartido, antes de su primer microtask/fetch | Transporte/body terminados; timeout de un waiter no termina warmup compartido |
| index.js, queryOpenCode/getOpenCodeStatus | probe cuando ejecuta CLI; inspección pura sigue administrativa | Child close y prueba remota cuando corresponda |

Rutas seguras de consulta permanecen sujetas a autenticación actual: workspaces,
active, listados y consultas de turnos. GET status actualmente ejecuta CLI
`opencode --version`: durante mantenimiento debe ofrecer estado de solo inspect
o ser una prueba administrativa registrada. No llamarlo «sin trabajo» mientras
ejecute procesos. GET de reconciliación puede escribir estado de turnos en memoria;
auditarlo y garantizar que no programe inferencia. Limpiezas periódicas deben
respetar recursos activos; no borrar un registro para resolver mantenimiento.
Auth/login/logout/pairing conserva sus protecciones; nunca una ruta pública nueva.

Hoy summaryInProgress y activationInProgress no son una barrera común. El summary
no adquiere proposalLocks.acquireExclusive; puede solaparse con activación.
proposalInProgress, generating por conversación y locks por workspace tampoco
impiden toda admisión. El backend actual no expone un contador global fiable.

## Archivos a editar solo en otra fase autorizada

1. Instalar los tres módulos candidatos en la ubicación de módulos del servidor,
   tras decidir y revisar las rutas definitivas; no importarlos desde candidates
   como dependencia runtime permanente.
2. `server/index.js`: construir el coordinador ANTES de warmup/listen; inyectarlo
   en handlers, configurar control Unix y verificadores, gestionar SIGTERM y
   recuperación. Mantener 3001 y las rutas HTTP. No importar index.js en tests
   porque abre SQLite, escucha y arranca warmup.
3. `workspace-routes.js`: admitir tras validación/autenticación, antes del primer
   await con efectos; nueva respuesta 503 segura para mantenimiento, sin cambiar
   rutas ni allowlists. La transición y admisión pertenecen al mismo coordinador.
4. `index.js` wrappers execFile/spawn: registrar recurso antes del primer turno
   asíncrono; marcar finalización raíz en finally; retener process hasta close.
   spawn error no demuestra ausencia de descendientes. No liberar en exit o
   callback de timeout. Docker exec/Compose requiere además evidencia remota.
5. `chat-routes.js`, `conversation-messages.js`, `chat.js`: una sola operación raíz
   por request. La creación actual de mensajes es síncrona y solo escribe SQLite;
   respond y las continuaciones sí requieren seguimiento de generación/persistencia.
   No terminar una generación por desconexión HTTP.
6. `actions.js` y `chat-read-continuation.js`: retener recurso deferred antes de
   programar, liberarlo en finally de la operación real. Una decisión nueva queda
   rechazada en DRAINING; lo ya admitido puede terminar con su ticket.
7. `proposal-security.js`, `change-proposal.js`, `apply-change-proposal.js`,
   `ollama-proposal.js`, `chat-ollama.js`, `ollama-warmup.js`: instrumentar promesas,
   transports y Git; Promise.race/AbortController no prueban terminación efectiva.
   No cambiar sus modelos ni plazos. Mantener warmup compartido como trabajo propio.
8. Tests nuevos de integración HTTP con factories/mocks; revisar manifests de
   fuentes de promoción después de cualquier cambio autorizado. El paquete actual
   debe rechazar cambios en fuentes hasta una nueva auditoría, no borrar ese control.

Evitar doble admisión de suboperaciones: las ya admitidas reciben el ticket padre
y recursos registrados. Un callback diferido nunca puede admitir por su cuenta
después de cerrar la barrera. Si perdió su ticket, falla cerrado.

## Prueba real de terminación y límites

El estado expone solo IDs sintéticos y tipos. El registro privado de integración
puede asociar PID/identidad de inicio y contenedor/exec ID a cada recurso; no
argv, prompts, stdout, auth o contenido. No deducir ausencia de procesos solo por
nombre ni reutilizar PID sin start time. Los wrappers actuales usan Docker CLI,
sin handle robusto al proceso remoto: diseñar y probar ese seguimiento antes de
promover. Si Docker no permite probar terminación, conservar UNCERTAIN y NO-GO.
No proponer eliminar procesos ajenos ni habilitar Docker socket dentro de contenedores.

En cada arranque, el verificador de recuperación debe demostrar que no sobrevive
trabajo de la instancia anterior y validar el checkpoint. El verificador de
incertidumbre debe demostrar terminación del recurso específico y descendientes.
No implementar ambos como `async () => true` para pasar tests. El módulo no
proporciona hoy esas pruebas de producción y la interfaz Unix no las puede forzar.

La barrera solo controla sus admisiones en UNA instancia. Preflight externo:
identificar todos los backends y coordinadores, cerrar nuevos clientes por un
procedimiento operativo autorizado, confirmar no CLI manual en host/contenedor,
comparar procesos con baseline idle y revisar trabajos Docker remotos. Un snapshot
instantáneo no elimina carreras de un usuario externo con permisos Docker.
Exigir ventana exclusiva; sin ella no declarar drenaje global.

## Control y aceptación administrativa futura

Directorio dedicado bajo runtime privado, 0700; checkpoint/lock/socket 0600.
Comandos locales status/drain/confirm/reopen/recover, sin TCP. recover solo llama
al verificador instalado; no acepta «evidencia» aportada en JSON. Identidad mínima:
UID completo del operador, aceptada explícitamente; no diferenciar actores mismo UID.
Revisar autorización antes de registrar callbacks fijos admin-health/reviewer/
summary/workspace. No devolver textos generados, body o credenciales por el control.
El módulo no ofrece un CLI de promoción ni un modo de eludir la sesión HTTP.

Para aceptación HTTP real: conservar login/CSRF actuales y diseñar una concesión
de una sola operación, vinculada a la sesión/acción exacta y workspace sintético,
emitida solo por el control local. No confiar en IP loopback, header arbitrario
o un booleano global de bypass. Esa concesión aún NO está implementada. Mientras
falte, el diagnóstico directo puede probar core, pero no declarar backend HTTP
aceptado. Cada prueba principal necesita su autorización de inferencia específica.

## Pruebas previas y rollback de integración

- Verificar todas las rutas autenticadas bajo NORMAL/DRAINING/MAINTENANCE, incluidas
  escritura de mensajes, decisiones y continuaciones. 503 antes de nuevos efectos.
- Probar carreras de body lento, transición y child spawn; timeout con proceso
  superviviente; error Docker; close de HTTP; continuidad diferida y warmup compartido.
- Probar recuperación con checkpoint/lock/socket stale, corrupción, disco lleno,
  permisos inseguros, pérdida de control y dos instancias. No autoabrir en fallo.
- Probar señales reales en backend aislado con mocks, nunca la instancia productiva;
  preservar plazos 110/120/105 y códigos/respuestas anteriores fuera de mantenimiento.
- Probar concesión de diagnóstico, expiración, consumo único, sesión incorrecta,
  logout y ninguna elevación de auth. Probar reopen y comportamiento previo.

Integración requiere autorización separada y un reinicio controlado futuro del
backend. Respaldar código/config y checkpoint antes; si falla, mantener cerrado,
conservar incertidumbres y resolver trabajos antes de revertir. Volver al código
anterior elimina la barrera: solo hacerlo con ventana operativa exclusiva todavía
vigente. No ejecutar reopen automáticamente como rollback ni borrar estado/locks
para aparentar servicio recuperado. No cambiar OpenCode u Ollama en esta etapa.

Decisión: CONDITIONAL GO para desarrollar integración con mocks en otra fase;
NO-GO para activar mantenimiento productivo o cutover con este candidato solo.
