# 5B.11A — Preparación operativa de META A

Auditoría del 9 de noviembre de 2026. PREPARADO — NO DESPLEGADO.
HEAD auditado: `b30e8dbff9e9f44eb106642edd0ae78a44c35c9d`; rama `main`,
sin diferencias con la referencia local `origin/main`. No se consultó GitHub
en esta fase. La publicación previa es contexto confirmado por el operador.

## Decisión vigente

**OPCIÓN B — NO-GO PRODUCTIVO.** La evidencia nueva no acredita cierre técnico
de admisión ni exclusividad operativa. No autoriza mantenimiento ni cutover.
El Gateway fue validado en ensayos temporales; no está desplegado.
NIVEL 2 no declarado.

Se revisaron la decisión 5B.10V, los planes de ventana B, las revisiones de
5B.10T y 5B.10U y los procedimientos de promoción. Permanecen vigentes:

- `GATE_INTEGRATION.patch`: RECHAZADO; una solicitud ordinaria provocaba
  DRAINING y bloqueaba la siguiente sin orden administrativa.
- Variante 5B.10U: RECHAZADA por contraejemplo de seguridad; conservar NORMAL
  indiscriminadamente admitía una operación incompatible con trabajo remoto.
- Barrera completa: NO AUTORIZADA en producción.
- Contrato CLI actual: insuficiente para certificar toda la descendencia remota.

No se reactivaron prototipos ni se repitieron pruebas sintéticas. Los resultados
históricos con mocks no son aceptación productiva.

## Estado operativo observado

**OBSERVADO:** backend Node iniciado mediante `npm run server`, con cadena
de padres shell/npm, terminal y sesión WSL. Se verificaron PID y marca de
inicio actuales en memoria durante la auditoría; no se publican aquí.
Listener HTTP en `127.0.0.1:3001`; frontend en loopback en el puerto 5173.
La configuración Vite reenvía las solicitudes del frontend al backend.

**NO OBSERVADO en la muestra:** hijos del proceso backend ni conexiones TCP
establecidas asociadas al backend. No se identificó un supervisor dedicado
PM2, nodemon o supervisord en los procesos/unidades consultados. Las unidades
TPM2 del sistema no constituyen evidencia de PM2.

**NO VERIFICABLE con estas observaciones:** ausencia de tareas JavaScript
diferidas o solicitudes admitidas, exclusión de todos los clientes,
relanzadores externos a la sesión inspeccionada y tareas programadas externas.
No se infiere ausencia de supervisión a partir de no observarla.

OpenCode y Ollama están running; conservan frente al baseline reconciliado
sus IDs, imágenes, puertos, usuario, hardening y montajes. Los mounts se
compararon por destino, tipo, RW y hash del origen contra el baseline privado,
sin divulgar rutas. La estructura de conexiones de red coincide. Bridge
conserva driver, scope, internal, IPv4/IPv6, IPAM y opciones históricas.
Hay diferencias históricas de StartedAt e identificadores de redes; no se
atribuye una causa. El inventario conserva nombres de redes e identidades de
contenedores. Durante esta fase no cambió el snapshot productivo.

Se observaron 11 contenedores existentes y 6 redes; solamente OpenCode y Ollama
estaban running. El backend mantiene acceso original a Ollama por loopback;
OpenCode todavía usa la arquitectura anterior, sin Gateway desplegado.

## Admisión, trabajos y evidencia remota

El acceso directo a 3001 sigue siendo una vía independiente del frontend.
Cerrar Vite o acordar una ventana con usuarios no cierra técnicamente esa vía.
Se deben considerar summary, activación, chat, respuestas y continuaciones,
decisiones de acciones, propuestas y aplicación, además de CLI manuales y
productores externos. Se conserva la autenticación y validación actuales;
no se consultaron rutas HTTP que pudieran iniciar procesos.

Los flags parciales de summary/activación no constituyen un registro global.
Las continuaciones pueden sobrevivir a la respuesta HTTP. El arranque inicia
warmup y las solicitudes también pueden iniciarlo. Una promesa vencida o un
cliente desconectado no prueban finalización del trabajo subyacente.

`docker top`, sin argumentos de procesos, mostró init y el proceso principal
OpenCode. La metadata no mostró ExecIDs activos en el instante consultado.
Eso no clasifica ejecuciones anteriores, descendientes independientes ni
invocaciones externas. No existe evidencia nueva de identidad individual o
terminación completa. Exit, close, ausencia de un nombre de proceso y parada
del backend siguen sin equivaler a drenaje certificado.

La ventana exclusiva sigue **NO VERIFICADA**. Antes de intervenir se requiere
cierre efectivo de todos los productores, conciliación de trabajos admitidos,
hijos locales y trabajo remoto incompatible, control del relanzamiento y
evidencia de estabilidad durante toda la intervención. Un proceso desconocido,
un inventario incompleto o una incertidumbre relevante implican NO-GO.

## Recursos sin carga generada

Muestra de lectura tomada aproximadamente a las 18:16 UTC; no se inició
inferencia ni se consultó la API de Ollama.

| Recurso | Observación |
|---|---|
| WSL: memoria total / disponible / libre | 9,71 / 7,47 / 4,51 GiB |
| WSL: swap total / usado | 8 GiB / 84 KiB |
| Presión de memoria WSL | Promedios some/full de 10, 60 y 300 s: 0,00 |
| Docker Engine: memoria informada / CPU | 9,71 GiB / 24 CPU |
| Backend Node: RSS / máximo RSS observado por el sistema | 76,7 / 79,2 MiB |
| OpenCode: memoria / CPU en docker stats | 517,4 MiB / 2,18 % |
| Ollama: memoria / CPU en docker stats | 106,7 MiB / 0,00 % |
| Contenedores: OOMKilled / RestartCount actuales | false / 0 en ambos |
| Disco disponible del repositorio | Aproximadamente 946 GiB |

También se observaron procesos npm y otros procesos Node del entorno; la
capacidad no está reservada exclusivamente para LAB-IA. Ambos contenedores
tienen Memory=0: sin límite individual, sujetos al límite global del Engine.
La memoria disponible dentro de la VM Docker no fue medida directamente.
No sumar memoria WSL y Docker como reservas independientes. Las métricas de
docker stats y RSS tampoco son magnitudes intercambiables.

**MEMORIA EN REPOSO:** muestra actual sin carga provocada por esta fase.
No demuestra que no exista actividad concurrente ni que un modelo esté cargado.
**PICO DE INFERENCIA:** no medido ni acreditado por esta muestra.
Gateway conserva presupuesto candidato de 256 MiB y 0,5 CPU; no es garantía
de capacidad bajo carga.

Para autorizar una futura medición se requieren exclusividad demostrada,
autorización explícita de una única ejecución acotada, imágenes/modelo ya
disponibles y observación de memoria en los dominios relevantes. Propuesta
de criterios a aprobar antes de esa prueba: margen mínimo de 1 GiB durante
la ejecución, además del presupuesto reservado del Gateway antes de empezar;
rechazo ante incremento de swap superior a 256 MiB, OOM, reinicios, deterioro
de servicios existentes o timeout no recuperado. Estos umbrales son criterios
propuestos, no validación de capacidad ni autorización actual. Si no puede
observarse el margen de un dominio necesario, no se inicia la prueba.
Registrar memoria disponible antes, pico durante la ejecución, swap, eventos
OOM y reinicios, duración, SSE, parser y efecto en los demás servicios.
Conservar 110 s OpenCode, 120 s execFile y 105 s por request del Gateway;
sin deadline experimental de 240 s ni reintentos adicionales.

## Paquete de promoción y recuperación

El verificador de lectura de `promotion/` dio PASS: 16 archivos del paquete
y 16 fuentes coinciden con sus manifiestos. Ambas imágenes fijadas por digest
están disponibles localmente para Linux/amd64; no se descargaron imágenes.
Se revisó la configuración de instalación: OpenCode solo FRONT; Gateway
FRONT+UPSTREAM, interfaces front0/upstream0, FRONT internal+isolated,
IPv6 deshabilitado, workspace RO, sin puertos publicados ni extra_hosts en
OpenCode. Provider `http://opencode-gateway:8080/v1`, modelo qwen3:8b.
Launcher con IPv4 única de front0, fallo cerrado, upstream fijo,
maxConcurrent=1 y límites originales. Hardening y presupuesto conservados.
Esta revisión documental no ejecutó Compose ni valida nuevamente su runtime.

El HOME sanitizado y ambos respaldos privados coinciden con los hashes
canónicos registrados previamente, incluidos permisos y propietarios. Sus
raíces tienen modo 0700 y UID/GID 1000:1000. El HOME anterior conserva metadata
de raíz y referencia de montaje; no se inspeccionaron sesiones ni credenciales.
No se afirma integridad completa de su contenido privado.
El cierre preparado conserva 27 paquetes: 7 contrastados con SRI y 20 mediante
versiones/hashes locales; no se declara autenticidad criptográfica completa.
El rollback productivo no se ha ejecutado; los ensayos temporales no lo prueban.

Correcciones pendientes, sin editar `promotion/`:

- BACKUP_PLAN: reconocer respaldo principal y complemento del historial como
  dos fuentes separadas y verificarlas sin sobrescribirlas.
- CUTOVER: validar el HOME ya preparado; no volver a ejecutar su preparación.
  Sustituir la ventana genérica por precondiciones operativas verificables,
  con control real del backend y relanzadores, antes de interrumpir servicios.
- ACCEPTANCE: reconciliar la referencia a una sola inferencia con las dos
  invocaciones principales previstas; exigir autorización y presupuesto claros.
  Las pruebas administrativas no implican reapertura general. Considerar warmup.
- ACCEPTANCE y ROLLBACK_PRODUCTION: obtener el historial de su complemento,
  conservar HOME anterior, volúmenes y redes compartidas; verificar cada fuente.
- Mantener evidencia posterior separada del respaldo original y exigir
  aceptación o rollback antes de reapertura. No ejecutar parches rechazados.

Gateway conserva egress convencional. DNS general, forwarding y aislamiento
del Internet de Ollama siguen pendientes; no se declara NIVEL 2 completo ni
compatibilidad universal de agentes.

## Matriz de condiciones

| Condición | Evidencia actual | Evidencia faltante | Riesgo | Comprobación necesaria | Decisión |
|---|---|---|---|---|---|
| A. Admisión | Backend accesible directamente; sin gate autorizado | Cierre técnico de todos los productores | Entradas durante intervención | Demostrar cierre también en 3001, terminales y productores externos | NO-GO |
| B. Trabajos locales | Sin hijos/conexiones en una muestra; flags parciales | Conciliación de solicitudes, diferidos y procesos | Interrumpir trabajo admitido | Registro verificable de finalización, sin usar solo HTTP o una espera | NO-GO |
| C. Remotos incompatibles | top y metadata puntuales | Clasificación completa y exclusión de desconocidos | Trabajo remoto superviviente | Evidencia suficiente de inactividad incompatible; incertidumbre bloquea | NO-GO |
| D. Supervisión | Arranque por npm/terminal; sin supervisor dedicado observado | Control de relanzadores externos | Reapertura involuntaria y warmup | Operador demuestra control del arranque y de su permanencia detenido | NO-GO |
| E. Memoria | Métricas actuales, sin OOM observado | Pico qwen3:8b y margen bajo carga | OOM, swap y degradación | Medición futura expresamente autorizada con criterios previos | CONDICIONAL |
| F. Aceptación | Ensayos temporales históricos y paquete consistente | Reviewer/parser/SSE/backend productivos tras cambio | Integración no funcional | Aceptación futura con auth, tools denegadas y límites originales | PENDIENTE |
| G. Rollback | Dos respaldos y HOME conservados | Runbooks reconciliados y recuperación productiva ejecutada | Restauración parcial o fuente equivocada | Revisar fuentes, permisos, configuración anterior y puntos de parada | CONDICIONAL |

## Siguiente paso único

**Obtener evidencia del operador de un control técnico existente que permita
cerrar todos los productores y conciliar el trabajo incompatible en una ventana
concreta.** La evidencia debe cubrir acceso directo a 3001, productores externos,
trabajos diferidos/remotos y relanzamiento; una declaración de intención no basta.
Si no existe esa capacidad, conservar NO-GO y no preparar una intervención
ejecutable. No se propone otro prototipo ni se autoriza integrar un parche.
La medición bajo inferencia y la reconciliación de runbooks siguen siendo
condiciones independientes posteriores, no evidencia ya obtenida.

## Alcance y cierre

Solo se creó este informe. Snapshot productivo sin cambios entre inicio y
verificación; backend conserva su identidad actual y listener loopback.
No se modificaron contenedores, redes, activos, HOME o respaldos. No hubo
instalaciones, inferencia, Docker exec, mantenimiento ni recursos temporales
de ensayo. Baseline privado conservado e ignorado localmente; no se copió a
este documento. Git únicamente se consultó en lectura, sin staging ni commit.
