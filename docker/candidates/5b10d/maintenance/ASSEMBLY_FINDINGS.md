# 5B.10O — Ensamblaje y terminación remota

PREPARADO Y ENSAYADO CON MOCKS. NO INTEGRADO EN PRODUCCIÓN.

## Resultado y alcance

Se ejecutó una copia en memoria del código de index.js y su grafo de 29 módulos
revisados, fijados por ASSEMBLY_SOURCES.json. No se importó el entrypoint productivo.
No se ejecutaron Docker, lab-open real ni modelos. El ensamblaje de inicialización
y wiring está cubierto bajo sustituciones; la cobertura funcional del sistema
completo sigue siendo parcial. No es E2E de producción.

Regresión final ejecutada: 64/64 pruebas previas PASS (1534,692 ms); 12/12 nuevas
PASS (571,768 ms), total 76 PASS, 0 FAIL, 0 SKIPPED, 0 canceladas. Node emitió
avisos experimentales de SQLite y VM Modules. Las primeras pruebas detectaron
exports ausentes en la fachada filesystem y falta de structuredClone en el VM;
se corrigió únicamente el arnés nuevo y se repitió su suite completa.

Comandos locales, sin servicios externos:

```bash
node --test --test-reporter=spec docker/candidates/5b10d/maintenance/barrier.test.mjs docker/candidates/5b10d/maintenance/backend-integration.test.mjs
node --experimental-vm-modules --test --test-reporter=spec docker/candidates/5b10d/maintenance/assembly-remote.test.mjs
```

## Arranque auditado de index.js

1. Importa factories y crea warmup (todavía no lo inicia), proposalStore/locks y
   actionStore; registra limpiezas de acciones/propuestas cada 30 s.
2. Resuelve raíz/agentes/runtime; abre SQLite y crea schema dentro de transacción.
   En fallo, cierra base y sale. No hay aquí una barrera productiva integrada.
3. Define inspect/query/status, snapshot seguro, parser y wrappers de procesos.
4. Construye propuestas/aplicación, turnos y limpieza, permisos de lectura,
   continuaciones, chat, mensajes, seguridad, acciones y rutas autenticadas.
5. Crea el router HTTP: auth, chat, workspaces, acciones y propuestas/aplicación.
6. Escucha en loopback productivo; adjunta pairing terminal e inicia warmup.
   server.close solo cierra pairing. No existe handler de SIGTERM que certifique
   drenaje de Docker o de procesos descendientes.

La copia candidata inyecta maintenance en las factories ya adaptadas y condiciona
el warmup inicial a NORMAL recuperado. Los cuerpos de snapshot, parser,
runWorkspaceSummary y runLabOpen se ejecutaron sin sustituir su lógica.

## Frontera del arnés

isolated-assembly.mjs usa SourceTextModule/SyntheticModule para enlazar código
conocido con fachadas explícitas; no se presenta Node VM como sandbox para código
hostil. Solo se cargan módulos cuyo hash coincide. Las URLs de módulos y todos
los archivos de ensayo pertenecen a un directorio temporal exclusivo.

| Dependencia | Sustitución y evidencia |
|---|---|
| node:http | Solo createServer; la petición de listen original se redirige a loopback/puerto 0. Se rechaza el puerto efectivo 3001/11434. No se expone un cliente HTTP al código ensamblado |
| node:child_process | Fachada que reconoce únicamente inspect/CLI simulados, realpath del runtime ficticio y lab-open ficticio. No crea procesos OS ni accede al Engine |
| global fetch | Mock inyectado y rastreado; valida contrato, devuelve Response sintética. Ningún socket hacia el destino representado |
| SQLite | DatabaseSync real, exclusivamente sobre el archivo temporal autorizado; schema de index y persistencia real de chat |
| Filesystem | Lectura/escritura limitada a fixture; snapshot puede abrir ancestros solo como directorios RO para recorrer su workspace ficticio |
| process/entorno | HOME/runtime ficticios, streams no TTY y exit rechazado; sin entorno, credenciales o consola productivos |
| Timers/logs | Timers del ensamblaje inventariados y retirados; salida de consola reducida a contador, sin contenidos |
| Control | Socket Unix temporal mediante módulo candidato existente; no TCP administrativo ni cambios en 3001 |

Las rutas probaron auth/session, rechazo autenticado/no autenticado, status,
summary, activación, listado activo, creación de conversación/mensajes y respuesta
de chat. Se comprobaron NORMAL/DRAINING/MAINTENANCE y reapertura, warmup bloqueado,
parser real y la diferencia entre fin de promesa/exit y close. Propuestas,
aplicación, continuaciones y decisiones siguen cubiertas por las suites previas
en sus alcances documentados; no se afirma éxito completo de propuesta/aplicación
en este ensamblaje. Pairing interactivo, SIGTERM real y efectos de producción
permanecen sin probar.

## Evidencia de terminación

| Evento | Qué demuestra | Qué no demuestra |
|---|---|---|
| HTTP cerrado | El cliente ya no espera | Fin del handler, Docker, modelo o continuación |
| Callback/exit local | Resultado del cliente observado por index | Cierre de todos sus recursos o fin remoto |
| close local | Terminación del cliente y cierre de sus streams | Fin de OpenCode/Compose/descendientes remotos |
| Consulta remota ligada a identidad | Estado del trabajo concreto, si el proveedor es confiable | Ausencia global de trabajos ajenos |

El contrato actual llama docker exec por CLI sin conservar exec ID. El timeout
interno 110 s y externo 120 s limitan espera, pero no identifican procesos huérfanos.
runLabOpen conserva solo el proceso Bash; resuelve en exit y su kill se dirige a
ese hijo, sin prueba de terminación de Docker Compose o de sus descendientes.
Ni un nombre opencode, ni un PID sin inicio, ni dos listados vacíos sustituyen
una identidad y una frontera de admisión de clientes externos.

remote-termination.mjs consume una observación confiable inyectada. Exige ID e
inicio del contenedor, exec ID, PID e identidad de inicio del proceso; comprueba
ejecución terminada, proceso específico ausente/terminado y cobertura de sus
descendientes. Consulta fallida/lenta, otro exec, PID reutilizado, reinicio,
trabajo activo o inventario incompleto mantienen incertidumbre. Nunca declara
globalQuiescence=true. No hay adaptador Docker productivo en este candidato.

Los mocks positivos representan evidencia hipotética, no evidencia que suministre
el CLI actual. Para producción se necesitaría crear/seguir una ejecución mediante
un contrato que conserve identidad y controle descendientes, persistir su vínculo
al job y auditar el proveedor de observaciones. No se propone implementarlo ahora.
El verificador da IDENTITY_INSUFFICIENT al contrato legado: bloqueador confirmado.

## Comparación de alternativas

| Criterio | A: barrera integrada | B: ventana operativa con backend detenido |
|---|---|---|
| Admisión | Atómica para hooks integrados; no controla CLI externas | Listener/backend ausente impide solicitudes normales; requiere exclusividad externa |
| Trabajos existentes | Registro fino si todos los hooks y recursos son correctos | Requiere inspección explícita; parar backend puede dejar trabajo remoto |
| Código | Cambios transversales, contratos de identidad y aceptación administrativa | Puede mantener código actual; procedimiento operativo separado |
| Recuperación | Checkpoint, locks, reconciliación y proveedor remoto | Recuperación de servicio más simple, sin dar procesos pendientes por terminados |
| Autorización | Socket, confianza en UID y aceptación HTTP específica pendiente | Operador local; autorización para parada/arranque, sin API administrativa nueva |
| Interrupción | Puede conservar consultas administrativas | Interrumpe UI/backend durante la ventana |
| Dependencias | Hooks completos, persistencia y observación remota verificable | Ventana exclusiva, baseline idle fiable y comprobaciones de procesos |
| Riesgo | Un hook omitido puede producir falso drenaje | Una parada abrupta puede perder solicitudes o dejar procesos huérfanos |

Para el cutover único META A se recomienda estudiar B por menor superficie de
cambio y recuperación más simple. No está implementada ni autorizada en esta fase.
B solo obtiene CONDITIONAL GO para diseñar/ensayar su procedimiento con mocks:
debe cerrar admisión operacional, esperar actividad conocida, detener únicamente
el backend autorizado y comprobar su salida/listener, trabajos remotos y procesos
ajenos contra un baseline idle fiable. Si hay procesos desconocidos o no se puede
probar su terminación, NO-GO: no matar huérfanos ni asumir que 120 s bastaron.
No detener/recrear OpenCode u Ollama como atajo de drenaje.

El arranque del backend actual inicia warmup automáticamente: la futura reapertura
puede cargar qwen3:8b y requiere autorización y presupuesto de memoria explícitos.
No es solo reabrir HTTP. No se ha medido el pico de inferencia en esta fase.

Decisión: NO-GO para integrar A en producción con este contrato remoto. CONDITIONAL
GO para un diseño/ensayo separado de B. Si B tampoco permite demostrar exclusividad
y ausencia de trabajo incierto, conservar NO-GO y revisar el contrato remoto.
Ninguna alternativa resuelve egress, DNS o NIVEL 2 completo.

## Runbooks y reversión

RUNBOOK_CORRECTIONS.md conserva principal + complemento de historial, HOME ya
preparado, validación sin recrearlo, aceptación, retorno al workspace original,
rollback y reapertura explícita. Se añade una rama conceptual B, sin aplicar los
runbooks promotion/ ni cambiar sus hashes. La elección A/B debe fijarse antes de
usar comandos; no mezclar ventanas ni abrir servicios para superar una prueba.

Revertir este ensayo solo elimina sus fixtures y listeners. Una futura reversión
de integración requeriría recuperar código autenticado anterior bajo ventana
exclusiva, conservar estado incierto y comprobar procesos antes de abrir. No borrar
locks/checkpoints, HOME, modelos, credenciales o respaldos para aparentar recuperación.
