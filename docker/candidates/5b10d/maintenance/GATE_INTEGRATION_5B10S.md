# 5B.10S — adaptador mínimo de admisión

PREPARADO — NO INTEGRADO. HEAD `04e5065`. No activa mantenimiento ni autoriza
cutover. Solo se añadieron admission-gate.mjs, admission-gate.test.mjs y este plan.

## Decisión de salida

**A: candidato apto para integración controlada, CONDITIONAL GO.** El alcance es
cerrar admisión de operaciones protegidas del backend. No se certifica exclusividad
remota, terminación de toda familia OpenCode ni memoria suficiente con inferencia.
Para cutover sigue **NO-GO**. La siguiente fase debe revisar el parche de integración
y su arranque/control privado; no ejecutar todavía la ventana ni promoción META A.

## Reutilización y tamaño del cambio

admission-gate.mjs solo compone createBackendHooks y openLocalControl sobre una
instancia de createBarrier suministrada por el ensamblaje. No introduce estados,
contadores, registros, verificador remoto, daemon ni transporte Docker nuevos.
No importa window-b: ese módulo sigue siendo un protocolo de ventana separado.
No se aplica el prototipo remoto de 5B.10R ni se toca la barrera existente.

- barrier.mjs mantiene NORMAL/DRAINING/MAINTENANCE, tickets durables y reservas.
- backend-hooks.mjs aporta dispatch, contexto, defer, child, trackedFetch, warmup
  y statusProbe. No liberar por cierre HTTP ni timeout de una espera.
- private-store.mjs aporta almacenamiento privado, escritura atómica y owner lock.
- local-control.mjs conserva socket Unix y autorización denegada por defecto.
- stage-backend.mjs se usa solo para ensayar transforms revisados de factories,
  nunca como instalador ni como dependencia productiva.

El adaptador no expone reopen como método HTTP ni añade diagnósticos con bypass.
openControl exige directorio explícito y privado. La instancia raw de barrier
pertenece al ensamblaje confiable, nunca a requests HTTP. status del adaptador
declara scope=BACKEND_TRACKED_OPERATIONS_ONLY y remoteExclusivity=NOT_VERIFIED.
Las respuestas del protocolo Unix existente contienen estado de esa instancia;
MAINTENANCE significa cero registros propios verificados, no ausencia universal
de trabajos en el contenedor.

## Admisión, auth y cierre

Los guards y validaciones originales siguen ejecutándose. dispatch se coloca
después de auth/body/validaciones previas disponibles y antes del handler que
produce efectos. La comprobación y registro de admisión no contienen await.
No se promete validar dentro del handler una ruta que fue rechazada antes de
ejecutarlo: los contratos normales conservan su validación completa.

Una conexión HTTP recibida o un body en lectura todavía no son trabajo admitido.
Si cierra el gate durante esa lectura, el dispatch posterior responde 503 sin
empezar efectos. Si ya se admitió, conserva ticket hasta terminar realmente.
Este punto de admisión evita cambiar auth por un rechazo genérico al comienzo
del listener. Corrige la necesidad de un registro previo al primer await sugerida
en 5B.10Q: no hay que contabilizar lectura no admitida como generación, siempre
que ningún efecto protegido ocurra antes de dispatch. Revisar eso para cada ruta.

El control reside en las factories alcanzadas por el listener de backend, no en
Vite: cubre también clientes directos, solicitudes nuevas en keep-alive y proxy.
Aquí se comprobó con loopback efímero; no se utilizó 3001 productivo.

## Archivos futuros y hooks imprescindibles

| Archivo productivo futuro | Cambio delimitado |
|---|---|
| proyectos/lab-ia-web/server/index.js | Crear store/barrier/adaptador antes de efectos de arranque; pasar hooks a factories; abrir solo control Unix; envolver procesos/transportes y observar su cierre |
| proyectos/lab-ia-web/server/workspace-routes.js | dispatch de summary/activate después del guard y lectura; statusProbe evita CLI en cierre |
| proyectos/lab-ia-web/server/chat-routes.js | dispatch de POST conversations/messages/respond antes de escrituras o generación; GET seguros conservados |
| proyectos/lab-ia-web/server/actions.js | dispatch de decisión antes de store.decide y de onDecision |
| proyectos/lab-ia-web/server/proposal-security.js | dispatch de propuesta y aplicación después de guard/validación y antes de efectos |
| proyectos/lab-ia-web/server/chat-read-continuation.js | defer reserva antes de schedule, liberación al terminar continueTurn |
| proyectos/lab-ia-web/server/ollama-warmup.js | admitWarmup antes del primer fetch; shared promise y transporte tienen seguimiento propio |

Los transforms candidatos de stage-backend.mjs describen esos seis hooks de
factories; no aplicarlos automáticamente a archivos activos. En index.js envolver
execFile/spawn con hooks.child antes de devolver al event loop. Una promesa del
handler que termina en exit no elimina el recurso hasta close; Docker/shell con
posibles efectos remotos requieren remote=true y mantienen incertidumbre porque
el contrato actual no proporciona un verificador suficiente. No usar verifyRemote
o verifyUncertain que devuelvan true sin evidencia.

Los fetch de warmup, chat, continuaciones y generación de propuesta deben recibir
hooks.trackedFetch mediante las dependencias ya disponibles; el patch futuro debe
comprobar la lista exacta de llamadas. Mantener reserva mientras el transporte
siga pendiente aunque haya terminado Promise.race. Leer EOF no prueba que Ollama
no tenga trabajo interno desconocido; cancelación o abort se conservan inciertos.
No crear un fetch global productivo ni alterar el contrato remoto.

Ubicación propuesta de módulos reutilizados para una futura instalación:
proyectos/lab-ia-web/server/maintenance/{admission-gate,backend-hooks,barrier,
private-store,local-control}.mjs. Copiar exactamente el código revisado; no cargar
runtime desde candidates ni copiar fixtures, stage-backend o el prototipo remoto.
Estas rutas son propuestas, no archivos creados. index.js puede pasar wrappers
por inyección; no se necesitan cambios de scripts/lab-open, Compose u Ollama.

## Control, recuperación y límites

Directorio futuro explícito derivado de runtimePaths.runtimeDir, por ejemplo
maintenance-control, propietario del operador y modo 0700; state/lock/socket
privados 0600. No crear ahora. Ninguna ruta HTTP administrativa, puerto TCP nuevo,
header de bypass, credencial en URL, sudo ni permiso adicional para OpenCode.

Conservar authorize=deny por defecto. La configuración administrativa deberá
autorizar explícitamente cada comando local permitido; no aceptar un booleano
enviado por un request ni instalar authorize=()=>true como atajo productivo.
El socket permite confianza en el UID propietario, no separación entre procesos
del mismo UID. Revisar ese dominio con el operador antes de integración.

El store existente conserva fail-closed en caída/reinicio; se requiere recuperación
verificada y reapertura explícita. No borrar owner.lock ni registros pendientes
automáticamente. recover solo usa el verificador confiable instalado; el comando
del socket no acepta evidencia aportada por el cliente. Incertidumbre remota sin
prueba suficiente mantiene drenaje bloqueado: no hay force-clear en el adaptador.

Consultas seguras siguen protegidas por auth. opencode/status debe utilizar solo
inspect durante cierre; no clasificar todos los GET como inocuos. Auth de sesiones
y pairing conserva su control original; no iniciar inferencia desde diagnósticos.
No se añade en esta fase un canal para pruebas administrativas de generación.

## Pruebas y cobertura real

```bash
node --test --test-reporter=spec docker/candidates/5b10d/maintenance/admission-gate.test.mjs
node --test --test-reporter=spec --test-name-pattern='^I(11 |21 |23 )' docker/candidates/5b10d/maintenance/backend-integration.test.mjs
node --test --test-reporter=spec --test-name-pattern='^I03 ' docker/candidates/5b10d/maintenance/backend-integration.test.mjs
```

Resultados ejecutados con Node local: **16 PASS, 0 FAIL, 0 SKIPPED**, en tres
ejecuciones acotadas: 12 casos / 460,435901 ms, 3 / 346,727867 ms y 1 / 203,654557 ms.
El runner solo contabilizó los seleccionados. No se reutilizan recuentos históricos.
Aviso de Node: SQLite experimental; las bases fueron exclusivamente sintéticas.

| Requisito | Evidencia actual |
|---|---|
| G01 NORMAL | Factory real de workspace con hooks candidatos y resultado sintético |
| G02 cierre y lecturas | 503 sin summary; GET workspace/status autenticados sin CLI |
| G03 acceso directo | HTTP real loopback efímero sin frontend, 200 antes y 503 después |
| G04 admitido | Handler real pendiente conserva ticket y bloquea confirm |
| G05 diferido | Hook reutilizado reserva antes del schedule; I11 ejercita además continuación y decisión reales con mocks |
| G06 timeout | Hijo EventEmitter simulado, close no elimina incertidumbre/recurso remoto |
| G07 warmup | Factory real copiada con fetch mock que nunca se inicia en cierre |
| G08 carrera | Lectura real del body y cierre antes de dispatch; cero efectos |
| G09 auth/validación | 401 sin sesión y 400 por body inválido antes de 503 con request válida |
| G10 fallo | Store simulado falla; respuesta 503 y reapertura rechazada |
| G11 autorización | Unix real deniega por defecto y durante cierre; reapertura explícitamente autorizada restaura admisión |
| G12 aislamiento | Sin fallbacks spawn/execFile/fetch; directorio 0700, socket 0600 y sin afirmación de exclusividad |
| I03/I21/I23 reutilizados | Activación, chat/escrituras, decisión, propuesta/aplicación: cierre autenticado y fallos normales seguros |

Las factories son copias de fuentes reales verificadas por hash con las inserciones
de stage-backend; no importan/arrancan index.js ni representan servidor completo.
I23 solo llega al preflight seguro de propuesta/aplicación, no aplica cambios reales.
El helper existente usa un store/security session y SQLite sintéticos en /tmp.
Las funciones globales sustituidas se restauran al acabar. No hay Docker real,
Ollama ni procesos externos en las pruebas; G06 simula eventos del hijo.

Cleanup específico cierra servidores y sockets, libera fixtures y elimina SQLite/
estado temporal. No se preparan HOME ni se leen sesiones reales. La verificación
de producción usa únicamente metadata de lectura, separada del arnés de pruebas.

## Integración y rollback futuros

1. Revisar un patch con los siete archivos/hook boundaries y los cinco módulos
   reutilizados; probar arranque, rutas y fallos con servidor ensamblado aislado.
2. Definir autorización Unix, directorio privado, recuperación verificable y orden
   de cierre del control/backend. No arrancar warmup antes de comprobar admisión.
3. Preparar rollback de código/configuración antes de solicitar una intervención;
   no cambiar producción en esta fase ni promover automáticamente META A.
4. Si alguna operación no puede seguirse, mantenerla incierta y NO-GO. No ampliar
   scope ni permisos para obtener PASS. Conservar límites 110/120/105 s actuales.

Rollback autorizado: cerrar admisión, reconciliar operaciones admitidas, preservar
estado privado y restaurar código anterior solo dentro de ventana exclusiva. No
retirar el gate ni reiniciar para volver a admitir mientras haya trabajos inciertos.
Si la instalación falla antes de activarse, conservar originales y no crear recursos
productivos. Si falla parcialmente, parar y conservar evidencia; no borrar registros,
HOME, SQLite o backups. Una restauración del backend anterior elimina el control
técnico de admisión: no continuar el cutover después de ese rollback.

Bloqueadores independientes: exclusividad remota y descendientes desconocidos,
control del relanzamiento/operador y memoria real con qwen3:8b. Gateway mantiene
presupuesto 256 MiB / 0,5 CPU. Sin carga en esta fase; no se declara NIVEL 2.
