# 5B.11F — Decisión operativa de cutover META A

ANÁLISIS CANDIDATO — NO EJECUTAR MANTENIMIENTO.
Fecha: 10 de noviembre de 2026 UTC, 9 de noviembre en America/Guatemala.
HEAD: `db675e145c2bf40a1a377e824c70a816ecd3d658`; main sincronizada con la
referencia local origin/main, árbol inicialmente limpio e índice vacío.
Git se utilizó únicamente en lectura; no se consultó el remoto.

**Decisión única: B — NO-GO PRODUCTIVO.** No hay evidencia suficiente para
autorizar hoy una futura ventana ejecutable sin barreras experimentales.
Una ventana operativa sin barrera integrada es una posibilidad condicionada;
no se ha demostrado que sus precondiciones puedan cumplirse en este entorno.
No se confunde una secuencia escrita con una capacidad operativa existente.

## Estado y fuentes revisadas

- [Decisión histórica 5B.10V](maintenance/META_A_DECISION_5B10V.md): investigación
  cerrada; GATE_INTEGRATION.patch y variante U RECHAZADOS; barrera no autorizada.
- [Preparación 5B.11A](META_A_OPERATIONAL_READINESS_5B11A.md): admisión y
  exclusividad pendientes, observaciones puntuales con límites explícitos.
- [Recursos 5B.11D–E](META_A_RESOURCE_TEST_PLAN_5B11D.md): basal recuperada,
  inferencia todavía no autorizada y cancelación/recursos efectivos pendientes.
- [Paquete de promoción](promotion/README.md), BACKUP_PLAN, CUTOVER,
  ACCEPTANCE y ROLLBACK_PRODUCTION: procedimientos reconciliados, no ejecutados.

La comparación de hashes de lectura conserva 16 entradas del paquete y 16
fuentes fijadas, sin discrepancias. Las notas de integridad pendiente que siguen
en el README describen 5B.11B; la reconciliación del manifiesto ya está presente.
No se editan esos documentos ni se ejecutan sus bloques. Integridad no equivale
a autorización ni a aceptación productiva.

Gateway/frontal isolated fueron validados temporalmente, no desplegados.
Producción mantiene OpenCode anterior y Ollama existente con acceso loopback del
backend. HOME sanitizado y respaldos principal/historial están preparados.
NIVEL 2 estricto no declarado. Los resultados con mocks no certifican producción.

## Mecanismo actual del backend y alcance de una parada

**OBSERVADO:** listener 127.0.0.1:3001 perteneciente a Node; cadena actual
Node → sh → npm run server → Bash → terminal/sesión WSL → init/systemd.
El directorio de ejecución coincide con el proyecto del backend. El proceso
tiene terminal de control y pertenece a su grupo de primer plano en la muestra.
No se publican PID, marcas de inicio ni identificadores operativos.
package.json define server como node server/index.js. No hubo petición HTTP.

No se observaron hijos locales del backend en ese instante. Las consultas de
unidades de servicio system/user no identificaron unidades dedicadas coincidentes.
Eso no excluye lanzadores manuales, tareas Windows/WSL externas, otras terminales
o mecanismos de relanzamiento fuera de la cadena inspeccionada.

**Respuesta sobre admisión:** si el proceso termina y permanece detenido, su
listener no puede admitir nuevas operaciones del backend. Esa propiedad no
demuestra una parada controlada de trabajos ya admitidos ni mantiene cerrados
OpenCode, Docker u Ollama frente a otros productores. En esta fase no se probó
parada, cierre de terminal, recepción de señales ni permanencia detenido.

La terminal propietaria es el punto operativo identificado para una futura
intervención del operador. Su control efectivo y el método concreto de salida
deben confirmarse antes de actuar. No se prescribe cerrar la ventana o enviar
una señal como si garantizara terminar toda la familia local/remota. No se
autoriza detener la sesión WSL, el backend u otros servicios aquí.

El index revisado no presenta un procedimiento general de drenaje/cierre de
trabajos mediante SIGINT/SIGTERM. El hook de cierre mostrado atiende la terminal
de pairing, no una certificación global de operaciones. No se ejecutó index.js.
La reapertura del backend inicia warmup: no es un arranque libre de efectos.

## Operaciones y productores fuera del control de la parada

| Productor/operación | Qué puede sobrevivir o iniciarse | Alcance de la evidencia |
|---|---|---|
| Requests admitidas por backend | Summary, activación, chat, propuestas, aplicación y escrituras en curso | Código real revisado; no hay registro global consultable de todos los trabajos actuales |
| Continuaciones diferidas | notifyDecision reserva trabajo en memoria y programa continueTurn mediante schedule | Fin HTTP no equivale a fin del trabajo; detener el proceso podría perder trabajo pendiente |
| Clientes locales Docker/scripts | Summary usa execFile/docker exec; activación usa spawn/lab-open | Terminar cliente o padre no certifica fin de efectos ni de todos sus descendientes |
| OpenCode persistente | Proceso principal con TTY/stdin disponibles; sesiones o ejecuciones manuales | Está presente; su nombre y permanencia no permiten decidir si hay una operación incompatible |
| Operadores y otras terminales | Nuevos docker exec, CLI, sesiones interactivas o scripts fuera del backend | No quedan bloqueados al cerrar 3001; productores completos y su retención no acreditados |
| Otros clientes de Ollama | Generación o carga que compita por memoria y afecte aceptación | La parada del backend no controla clientes independientes ni prueba fin de requests previas |
| Lanzadores externos | Nuevo backend o nuevas ejecuciones; warmup al arrancar | Ausencia de una unidad visible no demuestra imposibilidad de relanzamiento |

No se revisaron prompts, sesiones, SQLite ni credenciales. No se afirma que
actualmente existan trabajos huérfanos: se identifica una falta de evidencia.

El summary vigente tiene deadline remoto de 110 s y execFile de 120 s, pero esos
límites no acreditan terminación de toda la descendencia. runLabOpen resuelve
por exit y su timeout afecta al hijo local. Esperar ese plazo no cierra otros
productores ni demuestra por sí solo que ya terminaron sus efectos.
Warmup y continuaciones pueden seguir activos tras finalizar un HTTP; una
espera del caller puede vencer sin cancelar un warmup compartido.

## Evidencia de exclusividad

| Clasificación | Evidencia existente | Qué no demuestra |
|---|---|---|
| DEMOSTRADA | Proceso/listener y cadena actuales; identidad/estado/redes/mounts de contenedores; puntos de ejecución en código | Que el operador pueda cerrar toda admisión y conservarla cerrada |
| PARCIAL | docker top mostró init y OpenCode; campo ExecIDs devolvió null; ningún hijo local del backend en una muestra | Inventario completo de trabajo interno, descendientes, sesiones o productores externos |
| PARCIAL | RestartPolicy=no y RestartCount=0 en ambos contenedores; sin unidad dedicada coincidente observada para backend | Ausencia de reinicios manuales o relanzadores externos al runtime inspeccionado |
| NO DISPONIBLE | Conciliación completa y mantenida de trabajo incompatible bajo exclusividad; cierre verificable de todos los productores relevantes | No permite declarar C PASS ni autorizar recreación de OpenCode |

No se convierte null en evidencia de drenaje, ni se usa top como certificación.
Un proceso persistente esperado puede ser compatible con inactividad, pero no
se lo clasifica como inactivo únicamente por nombre o por falta de otro PID.
Un inventario completo debe distinguir procesos esperados, trabajo compatible,
trabajo que modifica el workspace/HOME y trabajo desconocido relevante.

No es obligatorio implantar trazabilidad permanente de cada job, una API de
mantenimiento o una nueva barrera para una única intervención. Sí es necesario
acreditar que durante esa intervención no hay trabajo incompatible y que no
puede empezar otro. La evidencia actual no satisface esa condición finita.

## Ventana futura condicional A–H — ninguna etapa ejecutada

Cada GO de esta tabla es un criterio futuro, no el resultado actual de una
prueba. Debe mantenerse la evidencia entre etapas y revalidarse si cambia el
estado. No hay script integral, señales o comandos de intervención nuevos.

| Etapa | Precondiciones | Evidencia mínima | GO | NO-GO | Acción conservadora ante fallo |
|---|---|---|---|---|---|
| A. Autorización humana | Responsable y alcance definidos; versiones/documentos revisados | Autorización expresa con recursos, interrupciones, aceptación/inferencia y rollback delimitados | Responsable acepta los límites y todas las puertas tienen medio de comprobación | Permiso genérico, aceptación sin autorizar o evidencia crítica sin medio disponible | No programar intervención ejecutable; conservar producción |
| B. Cese verificable de admisiones | A; todos los productores relevantes identificados | Medio operativo existente y aprobado que retenga frontend, 3001 directo, CLI y otros lanzadores incompatibles | Cese demostrable y mantenido durante conciliación, aceptación y rollback | Solo aviso, Vite cerrado, una muestra sin tráfico o mecanismo no acreditado | Detener la secuencia sin tocar servicios; no instalar T/U ni inventar gate |
| C. Conciliación local/remota | B vigente | Lista completa en el alcance de la ventana, vinculada al contenedor/generación y efectos; finales o compatibilidad justificados | Ninguna operación incompatible o desconocida relevante pendiente | HTTP cerrado, padre terminado, timeout o inventario parcial usado como prueba | No parar/recrear para ocultar incertidumbre; mantener estado y escalar al operador |
| D. Control de relanzamiento y parada backend | B/C PASS; terminal propietaria y relanzadores bajo control; autorización de interrupción | Identidad fresca y mecanismo real de salida, posterior ausencia de proceso/listener e hijos incompatibles, control continuo de no relanzamiento | Backend detenido por mecanismo autorizado y cierre mantenido | PID histórico, cerrar terminal sin comprobar efectos, generación nueva inesperada o incapacidad de retener relanzamiento | No tocar OpenCode; conservar diagnóstico y solicitar decisión del operador |
| E. Revalidar respaldos/HOME | D y exclusividad vigentes; validación preliminar ya realizada en A | Principal y complemento íntegros/vigentes, referencias de workspace/HOME coherentes; HOME nuevo existente, permisos y cierre auditado | Recuperabilidad verificable y ningún dato legítimo perdido | Backup obsoleto/ilegible, ruta ambigua, secreto inesperado o propuesta de recrear HOME | No sustituir activos; nueva copia/complemento solo con autorización, sin sobrescribir históricos |
| F. Cutover candidato | A–E PASS, imágenes locales y recursos/aceptación autorizados, sin colisiones | Gateway validado antes de recrear solo OpenCode; configuración efectiva y mounts/redes previstos | FRONT exclusiva/isolated, listener frontal, provider/hardening conservados, Ollama intacto | Bypass, escucha upstream, pérdida de hardening, recurso compartido afectado o cambio inesperado de Ollama | Detener cambio y aplicar solo rollback autorizado con trabajos conciliados; no limpieza global |
| G. Aceptación o rollback | F; cierre mantenido; recursos y generaciones de prueba autorizados | Criterios NET/FUN/DAT/SEC/RES; reviewer/parser/SSE, A→B→A y retorno original; recuperación o reversión verificadas | Aceptación completa o rollback completo aceptado por responsable | Falta evidencia, error no recuperado, OOM/degradación o recuperación parcial | Mantener cierre, conservar evidencia privada y ambos HOME; no borrar incertidumbres ni repetir inferencia |
| H. Reapertura autorizada | G PASS; estado estable y datos reconciliados | Autorización expresa, backend/listener correctos, workspaces/historial y servicios verificados | Apertura general explícita y retirada controlada de las restricciones operativas | Reabrir desde finally, arranque sin control o discrepancia pendiente | No abrir a clientes; escalar para recuperación autorizada |

El cese B no se da por hecho utilizando la parada posterior D: la secuencia
actual exige que lo ya admitido se concilie antes de interrumpirlo. No se
reordena silenciosamente para convertir una interrupción en drenaje.
Aunque se asumieran B y D logrados, el faltante remoto de C seguiría bloqueando
F. Esta es la razón mínima por la que parar el backend no habilita el cutover.

En G, un arranque administrativo del backend puede ser necesario para probar
HTTP y activa warmup. Requiere autorización, recursos y acceso exclusivo aún
retenido; no equivale a H. Si esa retención no puede mantenerse con backend
arrancado, no existe aceptación completa aprobable bajo esta ventana.

## Rollback y recursos independientes

Rollback está documentado y dispone de principal para configuraciones y
complemento para historial/ruta/modo original. Debe recuperar referencias del
HOME anterior, provider directo, lab-open y workspace, preservando ambos HOME,
modelos, volúmenes, SQLite y redes compartidas. No se ha ejecutado rollback
productivo: el ensayo temporal A→B→A y los hashes no sustituyen esa comprobación.
Un fallo parcial conserva cierre y evidencia; no habilita borrar recursos o
reabrir automáticamente. Su ejecución requiere autorización y conciliación.

Las mediciones anteriores de reposo registraron MemAvailable mínimo 7,36813 GiB,
swap 168 KiB constante, backend RSS máximo 76,88 MiB, OpenCode 554 MiB y Ollama
29,95 MiB. No se repitieron aquí. No acreditan pico de qwen3:8b ni insuficiencia
de RAM. Dominio efectivo Docker/VRAM, margen bajo carga y aborto de la request
siguen pendientes según 5B.11E. Gateway conserva 256 MiB/0,5 CPU propuestos.
La inferencia real continúa sin autorización; no se ejecuta para resolverlos.

## Riesgos y decisión verificable

Riesgos necesarios del cutover: interrumpir operaciones admitidas, recrear
OpenCode sobre trabajo superviviente, perder una continuación o escritura,
relanzar backend/warmup durante la ventana, aceptar con recursos insuficientes
no detectados o reabrir después de rollback parcial. No se afirma que esos
fallos hayan ocurrido. Las limitaciones de egress del Gateway, DNS general,
forwarding e Internet de Ollama permanecen fuera de una garantía NIVEL 2.

**B — NO-GO:** falta evidencia operacional completa y mantenida de ausencia
o compatibilidad del trabajo remoto relevante antes de recrear OpenCode,
incluso si el operador pudiera detener y retener el backend. El cese previo B
y el control de relanzadores tampoco están demostrados por la muestra actual.
No hay evidencia nueva que permita elegir A sin suponer esas capacidades.

**Siguiente acción única y concreta:** el operador debe presentar para una
ventana identificada una hoja de control con productores/responsables, medio
existente de cese y retención, y conciliación de trabajos incompatibles ligada
al contenedor/generación. Cada desconocido relevante debe quedar explícito;
si C no puede acreditarse, no programar el cutover. No se solicita desarrollar
otro mecanismo ni iniciar una investigación técnica abierta. La revisión de esa
evidencia es una puerta cerrada de reconsideración, no autorización operativa.

Esta fase solo crea este documento. No modifica runbooks, maintenance/, código,
configuración o estado privado, ni ejecuta servicios, carga, cutover o rollback.
