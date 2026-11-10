# 5B.11G — Hoja de control operativo META A

BORRADOR PENDIENTE DE EVIDENCIA — NO EJECUTAR LA VENTANA.
Auditoría: 10 de noviembre de 2026 UTC, 9 de noviembre local en Guatemala.
HEAD `7b64abc2397241f0d226e1d80039e18aee5da5d6`, main, referencia local
origin/main sincronizada, árbol inicialmente limpio e índice vacío.

**META A: NO-GO PRODUCTIVO. Exclusividad NO DEMOSTRADA.** Gateway no desplegado;
NIVEL 2 estricto no declarado. Esta hoja no activa controles, asigna personas,
concede privilegios ni autoriza mantenimiento, inferencia, rollback o cutover.

## Alcance y relación con 5B.11F

Esta hoja concreta el inventario y los campos que pidió
[5B.11F](META_A_CUTOVER_DECISION_5B11F.md). Conserva su secuencia A–H y el bloqueo
por falta de cese mantenido y conciliación del trabajo incompatible. No cambia
la decisión B ni considera suficientes una parada del backend o un top puntual.

También se revisaron [5B.11A](META_A_OPERATIONAL_READINESS_5B11A.md),
[recursos 5B.11D–E](META_A_RESOURCE_TEST_PLAN_5B11D.md),
[cierre histórico](maintenance/META_A_DECISION_5B10V.md) y los documentos de
[promoción](promotion/README.md), incluidos respaldos, cutover, aceptación y
rollback. Sus comandos no se ejecutan. Gates, barrera y parches T/U siguen
rechazados/no autorizados; ningún ensayo con mocks habilita producción.

El inventario cubre **diez clases conocidas**, no una lista completa demostrada
de todas sus instancias. Las categorías pueden encadenarse: frontend → backend
→ lab-open → Docker → OpenCode, o backend → continuación → Ollama. No contar
esa misma operación varias veces como trabajos distintos ni perder sus efectos
al terminar un eslabón. Un productor nuevo relevante amplía el inventario y
mantiene NO-GO hasta su clasificación y control.

## Observación actual y límites

Se observó el backend Node en 127.0.0.1:3001, con directorio del proyecto y
cadena Node → sh → npm run server → Bash → sesión de terminal WSL.
No tenía hijos locales en el instante consultado. No se inspeccionaron sus
prompts, memoria de sesiones, argumentos, credenciales o base SQLite.

OpenCode y Ollama están running. OpenCode tiene TTY/stdin habilitados; ambos
contenedores declaran RestartPolicy=no. Esto no demuestra inactividad ni
imposibilidad de relanzamiento manual/externo. Se registraron internamente
identidades/generaciones, redes y mounts para comparación, sin publicarlos aquí.

No se observaron solicitudes mediante HTTP ni se consultaron endpoints que
puedan iniciar trabajo. Los clientes web activos, las demás terminales, las
generaciones de Ollama y los estados diferidos actuales **NO se contabilizaron**.
El hecho de no observarlos no se transforma en cero trabajos.

## Roles propuestos — todas las asignaciones PENDIENTES

| Rol | Responsabilidad propuesta | Asignación y autoridad |
|---|---|---|
| R0 Operador de ventana | Define alcance y obtiene autorización; decide GO/NO-GO y reapertura | PENDIENTE de confirmación humana |
| R1 Responsable de clientes web/HTTP | Identifica clientes y demuestra cese/retención de sus entradas | PENDIENTE; no presume control de todos los clientes |
| R2 Responsable del backend | Terminal propietaria, trabajos locales/diferidos, warmup y relanzamiento | PENDIENTE; solo capacidades ya autorizadas |
| R3 Responsable de terminales/Docker/OpenCode | CLI, lab-open manual, sesiones y ejecuciones externas conocidas | PENDIENTE; no se otorgan permisos nuevos |
| R4 Responsable de clientes Ollama | Carga independiente, cancelación/fin y observación de recursos | PENDIENTE; no autoriza generar carga |
| R5 Responsable del entorno externo | Lanzadores, tareas externas y otros accesos relevantes | PENDIENTE; alcance fuera del repositorio por acreditar |
| R6 Revisor de evidencia/recuperación | Contrasta pruebas, vigencia de respaldos, HOME y recuperación | PENDIENTE; verificación antes de aceptar resultados |

Un rol puede coincidir con otro solo tras confirmación del operador; la etiqueta
no prueba identidad, acceso o capacidad. La confirmación humana es necesaria,
pero no sustituye evidencia técnica. Una segunda fuente de observación debe
contrastar el cese declarado y la conciliación; repetir la misma afirmación no
es evidencia independiente. No se presupone aislamiento entre procesos del UID.

## Inventario y matriz de controles actuales

En cada fila se separa el acceso permitido por el sistema del control de cese
necesario para la ventana. **SIN CONTROL DEMOSTRADO** significa que el cierre
operativo requerido no está acreditado, aunque existan auth o validaciones.
Las posibilidades descritas no son controles ejecutados ni nuevas capacidades.

| ID / productor | Fuente de admisión y efecto | Posible u observado | Control actual y responsable propuesto | Posibilidad operativa por acreditar | Evidencia necesaria para cese | Riesgo residual / faltante |
|---|---|---|---|---|---|---|
| A. Frontend web | Vite proxy /api/lab; acciones de summary, activación, chat, propuestas y aplicación; consultas de estado | Código confirmado; clientes activos NO VERIFICADOS | Sesión/CSRF y allowlist de rutas del cliente; R1. Cese: SIN CONTROL DEMOSTRADO | Retener todos los clientes conocidos por medios existentes bajo su responsable | Clientes identificados, control efectivo mantenido y ausencia de entradas nuevas contrastada con evidencia del servidor | Cerrar una pestaña/Vite no cubre 3001 directo, otras pestañas ni trabajo ya admitido |
| B. API/backend 3001 | Acceso loopback directo y proxy; auth, decisiones y handlers con efectos | Servicio observado; requests activas NO VERIFICADAS | Auth de sesión, origen/CSRF, límites de body, validaciones y locks parciales; R2. Cese: SIN CONTROL DEMOSTRADO | Control de sus productores y, solo tras conciliación/autorización, parada por terminal propietaria y retención del relanzamiento | Cese previo documentado, trabajos conciliados, identidad fresca y posterior proceso/listener cerrados bajo control sostenido | No hay cierre global autorizado; body en lectura, diferidos o remotos pueden sobrevivir al fin HTTP |
| C. Terminales/comandos | npm, clientes HTTP/CLI y scripts manuales fuera de la UI | Terminal de arranque observada; demás terminales NO VERIFICADAS | Acceso del operador al entorno, sin interbloqueo global; R3. Cese: SIN CONTROL DEMOSTRADO | Identificar y retener cada lanzador relevante existente | Origen y responsable de lanzadores, admisión retenida y efectos/hijos reconciliados por identidad | Un acuerdo verbal no impide otros comandos, tareas o accesos del mismo usuario |
| D. lab-open activo | Invocación backend con ruta o uso manual; recreación OpenCode y escritura de historial | Script/call site confirmados; ejecución actual NO VERIFICADA | Valida ruta/directorio y verifica workspace RO; R3 junto a R2 para invocación backend. Cese: SIN CONTROL DEMOSTRADO | Retener invocación manual y backend durante toda la ventana | Ninguna activación pendiente ni nuevo lanzamiento; efectos Compose, mount e historial conciliados | Manual evita locks de backend. El activo no es el candidato META A; no instalar infraestructura ni activarlo para comprobar cese |
| E. Docker CLI / exec | Backend o cliente con acceso al Engine; ejecuciones, attach y otras mutaciones | Acceso pasivo de auditoría observado; trabajos mutantes actuales NO VERIFICADOS | Permisos existentes de Docker; R3. Cese: SIN CONTROL DEMOSTRADO | Controlar los clientes/operadores relevantes sin modificar Docker ni añadir socket a contenedores | Lanzadores retenidos y operaciones locales/remotas conciliadas, ligadas a contenedor/generación | Cliente Docker terminado o ExecIDs vacío/null no acredita fin de la familia remota |
| F. OpenCode persistente | Proceso del contenedor, TTY/stdin y posibles sesiones/ejecuciones externas | Contenedor running y TTY/stdin observados; actividad de sesión NO VERIFICADA | Hardening y workspace RO protegen alcance, no cierran trabajo; R3. Cese: SIN CONTROL DEMOSTRADO | Retener sus fuentes interactivas/externas y clasificar proceso persistente y ejecuciones existentes | Evidencia del estado de sesiones/trabajos compatible con recreación, sin leer contenido privado | Persistencia no significa actividad ni inactividad; no recrear para eliminar incertidumbre |
| G. Warmup Ollama | Arranque backend y ensureReady desde operaciones; carga compartida del modelo | Código confirmado; warmup actual NO VERIFICADO | started/state/pending y plazos internos limitan duplicación; R2/R4. Cese: SIN CONTROL DEMOSTRADO | Retener arranques y callers; conciliar cualquier carga admitida | Finalización comprobable del trabajo admitido y ausencia de nuevo arranque/caller incompatible | Timeout de espera no cancela el warmup compartido; relanzar backend inicia warmup |
| H. Continuaciones/diferidos | Decisión autenticada de acción → schedule/continueTurn y generación/escritura posterior | Código confirmado; cola/trabajo actual NO VERIFICADO | Estados de turno y locks locales, sin barrera global; R2. Cese: SIN CONTROL DEMOSTRADO | Retener disparadores y conciliar trabajo ya reservado | Reservas, ejecución y efectos terminados/compatibles; no solo respuesta HTTP finalizada | Parar backend puede perder trabajo en memoria; un remoto iniciado puede continuar |
| I. Otros clientes locales de Ollama | Loopback y accesos del entorno; cliente independiente o uso manual | Servicio Ollama observado; clientes independientes posibles, no inventariados | Publicación loopback limita exposición, no exclusividad entre clientes; R4. Cese: SIN CONTROL DEMOSTRADO | Identificar clientes y retener cargas incompatibles por controles existentes | Inventario de clientes relevantes y evidencia de fin/compatibilidad de cargas; recursos observables | Generación no se deduce de CPU/RSS; cancelar cliente no confirma fin ni descarga del modelo |
| J. Externos no verificables desde repo | Otras terminales, automatizaciones, tareas Windows/WSL o relanzadores/accesos no identificados | Posibles; instancias/alcance NO DISPONIBLES en el repositorio | Ningún control de esas instancias demostrado; R5. Cese: SIN CONTROL DEMOSTRADO | El operador delimita y acredita control real del entorno existente | Productores relevantes identificados o exclusión justificada por evidencia independiente | No marcar N/A por desconocimiento; un productor desconocido relevante impide GO |

Las validaciones de acceso anteriores deben conservarse; no se propone logout
global, revocar credenciales, cambiar permisos o firewall como sustituto de
evidencia. No se asumió que el operador ya disponga de un control efectivo.

## Fuentes estáticas y efectos que requieren atención

- src/Viewer.jsx, src/Actions.jsx y src/lab-api.js generan llamadas autenticadas;
  vite.config.js configura proxy a 3001. security-http.js admite también los
  hosts loopback de 3001 con sesión/validaciones: cerrar el proxy no cierra esa vía.
- server/index.js registra rutas, ejecuta summary mediante Docker, activa
  workspace mediante lab-open e inicia warmup al arrancar. workspace-routes.js
  contiene flags parciales, no registro global de trabajos.
- GET /api/opencode/status llama getOpenCodeStatus con checkCLI por defecto y
  puede lanzar OpenCode --version dentro del contenedor. No usar esa ruta como
  observación supuestamente libre de nuevas ejecuciones durante la conciliación.
- scripts/lab-open activo admite una ruta existente (o selección interactiva),
  fuerza recreación de OpenCode, verifica mount RO y actualiza recent-workspaces.
  Se inspeccionó el código; no se ejecutó ni se leyó el contenido del historial.
- chat-read-continuation.js programa continueTurn después de una decisión;
  ollama-warmup.js mantiene una promesa compartida y la espera del caller puede
  vencer sin terminar esa carga. proposal-security.js conserva autenticación y
  validaciones para propuestas/aplicación, no un cierre de mantenimiento.

## Conciliación de trabajo activo: estados distintos

| Estado a distinguir | Evidencia utilizable si existe y es segura | Evidencia insuficiente / regla conservadora |
|---|---|---|
| Request HTTP viva | Identidad/tiempos de la operación y conexión/handler actuales correlacionados | Una conexión puede estar ociosa; ausencia/cierre HTTP no prueba fin de efectos |
| Trabajo local backend | Promesa/tarea/efectos y procesos asociados identificados, incluyendo reservas | Ningún hijo observado no demuestra que no haya trabajo JavaScript o diferido |
| Ejecución remota iniciada | Evidencia de ejecución ligada al contenedor y su generación, con alcance conocido | Existencia o ausencia de docker exec cliente/ExecID no basta para descendencia |
| Descendientes externos | Vínculo con operación y nacimiento de procesos, inventario con alcance suficiente y fin/compatibilidad verificados | Un PID o nombre aislado, timeout o salida del padre no certifica la familia |
| Generación de Ollama | Estado de generación y finalización atribuibles, bajo ausencia de cargas confundibles | Modelo residente, memoria estable o CPU baja no prueban fin de una request |
| Sesión persistente inactiva | Evidencia independiente de que no ejecuta trabajo incompatible y sus entradas quedan retenidas | Proceso persistente no equivale a trabajo activo; tampoco acredita inactividad |
| Desconocido | Registrar alcance, evidencia faltante y recurso posiblemente afectado | No inventar identidad/resultados: mantener PENDIENTE y NO-GO si es relevante |

Para cada operación conocida, conciliar origen A–J, admisión, trabajo local,
efecto remoto/diferido, recursos afectados y evidencia de terminación o
compatibilidad. Las referencias documentales no se presentan como runIds reales
que el contrato actual no ofrece. Los valores técnicos necesarios se verifican
en registro privado autorizado, sin copiar sesiones, tokens, prompts o IDs
completos a esta hoja versionable. Si no existe evidencia suficiente, no crear
otro verificador: mantener el faltante explícito.

## Hoja de la futura ventana — sin fecha asignada

Identificador simbólico: **META_A_WINDOW_PENDING**. No identifica una ventana
aprobada ni una ejecución real.

| Campo general | Valor |
|---|---|
| Fecha/hora y duración de intervención | PENDIENTES; no se inventan |
| Responsable R0 y asignaciones R1–R6 | PENDIENTES |
| Autorización, alcance y puntos de parada | PENDIENTES |
| Baseline fresco privado y revisión independiente | PENDIENTES |
| Principal y complemento: vigencia al instante del cambio | PENDIENTE; preparación anterior no sustituye revalidación |
| HOME nuevo ya preparado / referencia del anterior | PENDIENTE de revalidación; no recrear ni copiar HOME |
| Recursos bajo carga, aceptación autorizada y recuperación | PENDIENTES |
| Aprobación de apertura general | PENDIENTE; separada del arranque administrativo |

Cada PENDIENTE significa sin completar/verificar para esa ventana, no cero
trabajos. La columna final no es una autorización: cualquier pendiente crítico
mantiene el **NO-GO actual**. Si se considera un productor fuera de alcance,
R6 debe revisar la evidencia de exclusión; desconocido no equivale a N/A.

| Productor | Responsable | Control de admisión de la ventana | Evidencia de cese | Trabajo pendiente | Conciliación | GO/NO-GO |
|---|---|---|---|---|---|---|
| A Frontend | R1 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| B API/backend | R2 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| C Terminales | R3 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| D lab-open | R3/R2 — PENDIENTES | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| E Docker/exec | R3 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| F OpenCode persistente | R3 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, no clasificado | PENDIENTE | PENDIENTE → NO-GO |
| G Warmup | R2/R4 — PENDIENTES | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| H Diferidos | R2 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| I Clientes Ollama | R4 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, no contabilizado | PENDIENTE | PENDIENTE → NO-GO |
| J Externos | R5 — PENDIENTE | PENDIENTE | PENDIENTE | PENDIENTE, alcance desconocido | PENDIENTE | PENDIENTE → NO-GO |

En una futura fase autorizada, cada evidencia debe indicar fuente, alcance,
momento, resultado y revisión; las comprobaciones deberán sostenerse entre
etapas. No es suficiente rellenar PASS a partir de una declaración del rol.
La aceptación puede requerir backend arrancado y warmup: el control sobre
terceros debe mantenerse entonces, sin inferir que la apertura general ya está
autorizada. No trasladar una parada posterior a B/C para simular drenaje previo.

## Condiciones conjuntas de GO/NO-GO

GO requeriría todas estas condiciones acreditadas para la ventana concreta:

1. Alcance completo de productores relevantes y roles confirmados por operador.
2. Control efectivo existente de cada productor y nueva admisión incompatible
   impedida durante conciliación, intervención, aceptación y eventual rollback.
3. Confirmación humana acompañada de evidencia independiente de cese mantenido.
4. Trabajo local, diferido, remoto y externo conciliado: finalizado o compatible
   con las operaciones previstas, sin desconocidos relevantes pendientes.
5. Control del arranque, terminal propietaria y relanzadores; no solo PID parado.
6. Respaldos principal e historial vigentes y legibles; HOME preparado verificado
   y anterior preservado; recuperación documentada y autorizable.
7. Recursos acreditados para la intervención y aceptación previstas. La basal
   en reposo no acredita pico de qwen3:8b ni prueba insuficiencia de memoria.
   La inferencia continúa sin autorización; sus condiciones de 5B.11E persisten.
8. Puntos de parada y autorización de aceptación, rollback y reapertura separados.

No se exige mantenimiento avanzado permanente ni ausencia de toda actividad de
Docker: sí ausencia o compatibilidad demostrada del trabajo relevante. Falta de
una condición crítica o evidencia dudosa implica NO-GO, sin relajar controles.
Los ensayos temporales del Gateway o A→B→A no sustituyen aceptación/rollback
productivos. Esta hoja no cambia arquitectura, hardening, modelo ni límites.

## Eventos de aborto / decisión de parada — no ejecutados

| Evento | Decisión y conducta futura conservadora |
|---|---|
| Productor desconocido relevante o nuevo trabajo incompatible | NO-GO; detener avance y conciliar sin crear mecanismos ni matar procesos |
| Trabajo remoto incierto o estado que no puede clasificarse | NO-GO; conservar evidencia, no recrear OpenCode para eliminar la duda |
| Relanzamiento inesperado o nueva generación no autorizada | NO-GO; no atribuir continuidad al PID anterior ni continuar el cutover |
| Pérdida de observabilidad/control de admisión | NO-GO; ningún plazo de espera reemplaza la evidencia perdida |
| Respaldo desactualizado/ilegible, duda sobre HOME o riesgo de pérdida de datos | NO-GO; no sobrescribir respaldos, HOME, historial o SQLite |
| Fallo de aceptación, bypass, OOM o cambio inesperado de recursos | NO-GO; preservar evidencias y decidir rollback solo con autorización y trabajos conciliados |
| Rollback parcial o recuperación no verificada | Mantener NO-GO y no reabrir automáticamente; no continuar eliminando recursos |

No se ejecuta ninguna acción de aborto en esta fase. No se habilitan señales
genéricas, prune, reinicios o parada de servicios compartidos. Conservar evidencia
no permite escribir en respaldos históricos ni exponer datos privados.

## Próxima decisión concreta

**La hoja está preparada; la ventana no está habilitada.** Todas las asignaciones
y observaciones futuras siguen pendientes. La exclusividad continúa NO DEMOSTRADA
y META A sigue NO-GO productivo, conforme a 5B.11F.

Siguiente acción única: revisión del operador para confirmar los roles propuestos
y aportar, en las filas A–J, los controles existentes y evidencia independiente
disponible de cese/conciliación. Si una fila crítica queda SIN CONTROL DEMOSTRADO
o conserva trabajo remoto desconocido, la decisión es no programar la ventana.
No se propone otra fase de prototipos ni se autoriza ejecutar controles ahora.

Solo se crea esta hoja; no se modifican fuentes, runbooks, maintenance/, HOME,
respaldos o configuración. No se realizan requests a backend/Ollama, inferencia,
docker exec, lab-open, reinicios, mantenimiento, cutover o rollback.
