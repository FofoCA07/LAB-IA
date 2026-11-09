# 5B.10Q — gate mínimo e inventario remoto

AUDITORÍA Y DISEÑO CANDIDATO — NO DESPLEGADO. No autoriza mantenimiento,
cutover, inferencia ni cambios en el backend. Inspección del 9 de noviembre de
2026 UTC sobre HEAD `04e5065`. Las fuentes activas y promotion/ permanecen intactas.

## Decisión

Un gate mínimo es viable para cerrar nuevas admisiones del backend, incluyendo
acceso directo a 3001. No basta un contador de respuestas HTTP. La infraestructura
observada ofrece un inventario de procesos repetible, pero no prueba completa de
trabajo remoto terminado. Por tanto: NO-GO para la ventana/cutover actual.

Recomendación única para el siguiente paso: **opción 3, precisar y ensayar un
contrato de identidad de ejecución remota**. No integrar la barrera completa ni
desarrollar tres soluciones. El gate se conserva como diseño mínimo necesario,
pendiente de resolver esa dependencia. Esta fase no cambia el contrato productivo.

## Admisión real y finalización

| Entrada o efecto | Código activo | Admisión y evidencia necesarias |
|---|---|---|
| POST workspace-summary | workspace-routes.js, index.js/runWorkspaceSummary | Reservar antes del trabajo; conservar snapshot, cliente y ejecución remota hasta evidencia de terminación |
| POST workspaces/activate | workspace-routes.js, index.js/runLabOpen, scripts/lab-open | Contabilizar selección, proceso y efectos Docker; exit del script no sustituye close ni reconciliación de efectos inciertos |
| POST conversations, messages, respond | chat-routes.js, conversation-messages.js, chat.js | Cubrir escrituras y generación; conservar auth, CSRF, límites y validaciones |
| POST actions/decision | actions.js, action-store.js | Cubrir decisión, lectura/escritura autorizada y reserva de continuación antes de programarla |
| Continuación de lectura | chat-read-continuation.js/notifyDecision | Reservar antes de schedule; liberar en finally de continueTurn, nunca al terminar HTTP |
| POST change-proposal y apply-change-proposal | proposal-security.js y handlers de propuesta/aplicación | Cubrir generación, locks y escrituras; no liberar por un deadline de espera |
| Warmup al arrancar o compartido | index.js/listen, ollama-warmup.js/ensureReady | Gate propio antes del primer fetch, registro independiente de los solicitantes; reinicio cerrado no inicia warmup |
| execFile y spawn | index.js | Registrar antes de crear cliente; close local, ejecución remota y descendientes son evidencias diferentes |
| Limpiezas periódicas de stores | index.js | Caducan estado de RAM, no lanzan por sí mismas inferencia; revisarlas al parar y no confundir caducidad con terminación |
| Solicitudes o CLI manuales externas | Fuera de la admisión del backend | Exclusividad operacional independiente; el gate de aplicación no las bloquea |

Las consultas GET no son todas inocuas: opencode/status puede invocar la CLI
para comprobar versión. Debe bloquearse o convertirse explícitamente en consulta
sin ejecución durante mantenimiento; no incluirlo en una allowlist genérica GET.
GET de turnos puede reconciliar estados terminales, aunque no inicia inferencia.
Auth, consultas seguras aprobadas y diagnóstico local deben conservarse mediante
una lista explícita de efectos, nunca permitiendo todos los GET por defecto.

## Diseño mínimo del gate, sin integración ahora

1. Registrar sin await la entrada y su ticket en el listener, antes del primer
   punto asíncrono. Cerrar admisión en el mismo event loop; una petición o queda
   admitida antes del cierre o no puede iniciar efectos. Incluir keep-alive y
   acceso directo a 3001; cerrar Vite no constituye este control.
2. Conservar los guards, comprobaciones de sesión tras leer el body y validaciones
   actuales. El rechazo de mantenimiento debe ocurrir en la frontera autenticada
   antes de los efectos. El registro temprano no concede autorización. Harían
   falta hooks de esa comprobación en las factories protegidas para conservar
   también los errores de autenticación actuales; un único if al inicio no basta.
3. Contabilizar la promesa real del handler, no finish/close de la respuesta.
   Cada recurso adicional obtiene una reserva antes de crearse; liberación
   idempotente. No ejecutar nuevas tareas desde un ticket ya terminado.
4. Hooks adicionales imprescindibles: reserva previa a schedule de continuaciones;
   admisión y recurso independiente del warmup; close de procesos hijos;
   transporte/promesas que sobreviven a Promise.race; prueba remota independiente.
   Timeout, abort, cierre HTTP o cancelación de lectura no certifican fin remoto.
5. Control local privado sin ruta HTTP administrativa ni puerto nuevo. Directorio
   0700 y socket 0600, comandos acotados, autorización explícita. Procesos del
   mismo UID pertenecen al mismo dominio de confianza. No usar un header público
   de bypass para aceptación. Diagnóstico seguro no reabre admisión.
6. Persistir cierre antes de confirmarlo; al fallar almacenamiento/control o al
   reiniciar, arrancar cerrado. Reconciliar reservas antes de reapertura explícita.
   Admitir las pruebas de aceptación mediante una capacidad local acotada y
   autorizada, manteniendo cerrado el servicio general.

Se reutilizan ensayos existentes para estas propiedades; no se implementó otra
máquina de estados ni un nuevo servicio. Las pruebas de componentes de la barrera
completa no demuestran que este diseño reducido esté integrado en el backend.

## Observabilidad real inspeccionada

Consultas efectuadas: inspect, top y GET de solo lectura del endpoint top del
Engine mediante su socket ya existente. No se creó exec ni se leyeron argv,
prompts, sesiones o entorno del agente.

- OpenCode conserva identidad y marca de arranque verificadas contra el baseline privado.
- top observó procesos docker-init y opencode con una relación de parentesco.
  Sus identificadores pertenecen al entorno del Engine; el PID contrastado
  no tenía entrada correspondiente en /proc de Ubuntu WSL. No asociar
  por igualdad numérica un PID Docker con uno de WSL.
- inspect devuelve ExecIDs=null en la muestra. Indica ausencia de IDs listados
  en ese instante, no ausencia de inferencia, tareas internas o trabajo externo.
- top con lstart confirma el inicio observado de esos procesos, pero el formato
  de columnas del Engine separa espacios en la fecha. No usar ese resultado como
  identificador preciso de nacimiento ni parser de identidad individual.
- Procesos locales se consultaron con PID/PPID/comm y tiempo; sin cmdline. Esto
  permite detectar clientes observados, no atribuir trabajos ni certificar que
  no existen productores externos. Un mismo proceso persistente puede trabajar
  sin crear un PID adicional.
- El listener sigue en 127.0.0.1:3001, atendido por el proceso Node observado,
  bajo npm/sh. No se ha probado el control de todos los posibles mecanismos
  externos de relanzamiento.

Resultado: **inventario puntual de procesos SÍ; inventario completo de trabajos y
terminación remota operativa NO VERIFICADOS**. No se ejecutó exec inspect de un
trabajo nuevo porque crearlo está prohibido. Tampoco se afirmó que un exec ID o
un árbol de PPID aislado prueben ausencia de descendientes reparentados.

## Comparación y siguiente contrato

| Opción | Alcance, riesgo y reversión | Decisión |
|---|---|---|
| 1. Gate mínimo + comprobación operativa | Menos código, requiere hooks asíncronos y control local; reversible retirando hooks después de reconciliar. Hoy no resuelve el inventario remoto ni exclusión de clientes externos | Insuficiente para autorizar ventana |
| 2. Barrera completa | Mayor registro y recuperación; más integración y persistencia que mantener. No genera la identidad que el CLI no devuelve | No integrar ahora |
| 3. Contrato de ejecución remota | Cambio delimitado pero sensible del adaptador de ejecución; admite pruebas con mocks antes de autorizar pruebas reales. No requiere por diseño nuevos privilegios: el backend ya ejecuta Docker | Recomendada para el siguiente diseño/ensayo |

Especificar antes de implementar: identidad de contenedor y generación, ID de
ejecución capturado al crear el trabajo, evidencia de estado final del exec,
identidad de nacimiento del proceso cuando sea obtenible y una política demostrable
para sus descendientes. Investigar un adaptador del Engine con exec ID retornado,
sin suponer que Docker por sí solo garantiza un árbol completo. Si la consulta
no puede probarlo, mantener incertidumbre y NO-GO. No iniciar trabajo para obtener
estos datos en esta fase.

También deben clasificarse el OpenCode persistente ya existente y ejecuciones
manuales: un registro nuevo no acredita retroactivamente trabajos anteriores.
Necesitarán reconciliación y exclusividad del operador sobre todos los productores;
si no pueden demostrarse, no seguir al cutover. Activación via lab-open conserva
su contrato de un argumento y necesita reconciliación propia de sus efectos, no
se debe presentar como un exec remoto equivalente al reviewer.

Archivos productivos que requeriría una futura propuesta: index.js para el
adaptador runWorkspaceSummary y wiring; un módulo nuevo local de ejecución cuya
ruta se decidirá en esa propuesta. La adopción posterior del gate exigiría además
hooks de auth/admisión en workspace-routes.js, chat-routes.js, proposal-security.js
y actions.js, reservas en chat-read-continuation.js, warmup y transportes. No
editar backend, Compose, lab-open ni OpenCode en esta fase. No montar Docker socket
en contenedores ni añadir sudo, herramientas del agente o permisos nuevos.

Rollback futuro del adaptador: cerrar admisión, reconciliar ejecuciones de ambas
versiones, preservar registro/evidencia, restaurar los archivos previos y verificar
contratos antes de reabrir con autorización. No volver al CLI ni borrar registros
con trabajo incierto para aparentar drenaje. Requiere una fase autorizada y pruebas.

## Ensayo acotado de esta fase

Se reutilizaron pruebas auditadas, sin una suite nueva ni ejecución productiva.

| Selección | Resultado actual | Qué demuestra |
|---|---|---|
| barrier.test: T09, T10, T14, T30 | 4 PASS, 0 FAIL, 0 SKIPPED; 147,803253 ms | Reservas diferidas, orden atómico, fallo de persistencia/control cerrado; unitario de componentes existentes |
| window-b.test: T01, T02, T04, T10, T12 | 5 PASS, 0 FAIL, 0 SKIPPED; 1399,747747 ms | HTTP loopback efímero simulado, trabajo admitido, desconocido/incompleto NO-GO y autorización; procesos sintéticos |

Total de la ejecución válida: 9 PASS, 0 FAIL, 0 SKIPPED. El runner no incluyó en
su recuento los casos excluidos por el filtro. El primer intento restringido falló
a nivel de proceso de tests sin diagnóstico útil; no se contabiliza como PASS.
Se repitió con permiso de ejecución local fuera de esa restricción, sin modificar
tests. No se atribuye una causa más concreta que la evidencia disponible.

No se probaron handlers reales ni inferencia en este ensayo. Los resultados
históricos 76/76 y 12/12 no se presentan como regresión completa de esta fase.
Los fixtures crean solamente procesos Node sintéticos, IPC y loopback efímero;
no usan 3001/11434, Docker, Ollama, HOME o bases productivas. Cleanup propio
mediante hooks de tests; no quedó directorio labia-5b10p-* ni proceso de esa fixture.

## Runbooks y puertas pendientes

WINDOW_B_RUNBOOK_CORRECTIONS.md sigue siendo aplicable: conservar respaldo
principal y complemento de historial por separado; validar HOME ya preparado sin
recrearlo; rollback preserva HOME/volúmenes/modelos y requiere reconciliación.
promotion/ no se modifica ni ejecuta. No aplicar aún RUNBOOK_CORRECTIONS.diff.

Antes de actualizar runbooks: demostrar gate efectivo, cierre atómico, finalización
de admitidos/transportes/hijos, inventario remoto suficiente, ausencia de relevantes
desconocidos, exclusión de nuevos productores y control de reinicio. Verificar el
estado antes de cada paso sensible; no sustituir evidencia por un tiempo de espera.
Aceptación futura con Ollama real solo con autorización, acceso administrativo
acotado y recursos medidos; reabrir requiere autorización separada.

Memoria de inferencia sigue pendiente. Presupuesto Gateway 256 MiB / 0,5 CPU;
no inferir capacidad a partir de Ollama inactivo. Egress independiente, DNS,
forwarding y aislamiento de Internet de Ollama siguen pendientes: META A no es
NIVEL 2 completo.

## Validación de entorno

Snapshot final idéntico al inicial de esta fase: IDs, StartedAt, imágenes, redes,
puertos, mounts normalizados, hardening y archivos activos. Coincide también con
el baseline reconciliado 5B.10N-C. Inventario: 11 contenedores, 6 redes, sin recursos
Docker nuevos. Listener backend e identidad del proceso conservados.

Hashes canónicos de HOME nuevo y ambos respaldos coinciden con los anteriores;
HOME anterior solo se comprobó mediante metadata de raíz y referencia de mount,
sin leer sesiones privadas. Una comparación inicial del HOME nuevo usó orden de
Path en vez de ordenar las tuplas relativas: al aplicar la normalización histórica
coincide, sin cambiar archivos. No atribuir esa diferencia del verificador al HOME.

Único archivo añadido por esta fase: este informe. Sin cambios activos, staging,
commit, push, instalaciones, descargas ni inferencia. Resultado: fase de auditoría
y decisión completada; NO-GO para mantenimiento/cutover, CONDITIONAL GO únicamente
para diseñar y ensayar con mocks el contrato remoto identificado arriba.
