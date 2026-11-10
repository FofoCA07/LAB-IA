# 5B.11D — Protocolo candidato de medición de recursos

PREPARADO — NO EJECUTADO. META A: **NO-GO PRODUCTIVO**.
NIVEL 2 estricto no declarado. Gateway no desplegado.

Fecha local de auditoría: 9 de noviembre de 2026, America/Guatemala.
Comprobación de metadata: 10 de noviembre de 2026, aproximadamente 00:47 UTC.
Repositorio en `main`, HEAD `e465b9f37fc1f43df9b7bb2237e7a1be9735b151`,
inicialmente limpio y sincronizado con la referencia local `origin/main`.
No se consultó GitHub ni se realizó ninguna escritura de Git.

## Evidencia revisada y alcance

Se revisaron [5B.11A](META_A_OPERATIONAL_READINESS_5B11A.md), la
[decisión histórica](maintenance/META_A_DECISION_5B10V.md), README, CUTOVER,
ACCEPTANCE, ROLLBACK_PRODUCTION, MANIFEST.sha256 y Compose de instalación de
`promotion/`. El manifiesto ya contiene la reconciliación documental de 5B.11C.
Las notas de integridad pendiente de 5B.11B son históricas: no constituyen un
resultado actual del verificador, que no se ejecuta en esta fase.

Producción continúa con OpenCode y Ollama existentes; backend fuera de esos
contenedores en loopback 3001. Los ensayos históricos de Gateway, frontal
isolated, reviewer y HOME no son aceptación productiva. Los parches T/U siguen
rechazados y la barrera completa no está autorizada. No se reconstruye ninguno.

## Registro de observación e incidencia

Se ejecutaron **exactamente tres muestras pasivas**, con espera programada de
5 segundos después de completar cada muestra anterior. Cada muestra consultó
meminfo, PSI/vmstat, proceso/listener, docker stats --no-stream e inspect de los
dos contenedores. La duración de cada consulta añade tiempo al intervalo; no se
afirma una cadencia exacta de 5 segundos.

El resumen falló después de las tres muestras al interpretar la lista de otros
consumidores: un nombre de proceso con espacios hizo que se intentara convertir
una palabra a entero. El recolector mantenía las muestras en memoria y no llegó
a devolverlas. **No se recuperaron valores ni marcas temporales individuales.**
No hubo una cuarta muestra ni reintento; tampoco se crearon logs o monitores
persistentes. El fallo es del recolector de observación, no de Ollama ni prueba
de presión de recursos. No se oculta ni se sustituye por resultados históricos.

### Tabla basal de esta fase

NV significa NO VERIFICADA: lectura intentada, valor no recuperado.

| Métrica | Muestra 1 | Muestra 2 | Muestra 3 |
|---|---|---|---|
| MemTotal / MemAvailable / MemFree WSL | NV | NV | NV |
| SwapTotal / SwapFree / SwapUsed WSL | NV | NV | NV |
| RSS / máximo RSS del backend | NV | NV | NV |
| Uso de OpenCode según Docker | NV | NV | NV |
| Uso de Ollama según Docker | NV | NV | NV |
| PSI / actividad de swap / OOM del kernel | NV | NV | NV |
| Otros consumidores y variaciones | NV | NV | NV |

La referencia 5B.11A registró 7,47 GiB disponibles en WSL, 76,7 MiB RSS backend,
517,4 MiB OpenCode y 106,7 MiB Ollama. Son cifras históricas en reposo, no
mediciones actuales ni máximos. **PICO DE INFERENCIA: NO MEDIDO.**

### Configuración recuperada mediante lectura separada

Esta lectura de límites/estado no repitió mediciones de utilización:

| Propiedad | Observado |
|---|---|
| Docker Engine | Docker Desktop, Engine 29.5.3, cgroup v2/cgroupfs |
| Memoria total visible para Engine | 10 424 614 912 bytes, aproximadamente 9,71 GiB |
| CPU visibles para Engine | 24 |
| Memory / MemoryReservation de ambos contenedores | 0 / 0: sin límite/reserva individual configurados |
| MemorySwap de ambos contenedores | 0: valor de configuración, no tamaño de swap disponible |
| OpenCode / Ollama | running; OOMKilled=false y RestartCount=0 al comprobar metadata |
| Backend | Listener y proceso presentes en 127.0.0.1:3001 |
| Gateway candidato | 256 MiB y 0,5 CPU; presupuesto propuesto, sin validación bajo carga |

OOMKilled=false en un instante no demuestra ausencia de todos los OOM históricos
o de otros procesos. Sin contadores basales conservados no se calcula un delta.

## Dominios de memoria y presión

| Dominio | Métrica y uso correcto | Límite de la observación |
|---|---|---|
| Linux WSL | MemAvailable estima margen; MemFree sola no describe memoria recuperable. SwapUsed=SwapTotal−SwapFree, PSI y pswpin/pswpout muestran presión/actividad | Valores actuales perdidos; no asumir equivalencia con la VM del Engine |
| Docker Desktop/Engine | MemTotal describe techo global visible; no es memoria libre | MemAvailable y swap del host efectivo del Engine NO VERIFICADOS |
| Cgroup OpenCode | memory.current, memory.stat, memory.events y límites de su jerarquía, si existe acceso de lectura ya autorizado | Lectura directa del cgroup de la VM no acreditada; no usar docker exec para obtenerla |
| Cgroup Ollama | Las mismas métricas para aislar memoria/eventos atribuibles al servicio | Docker stats es una vista distinta, no el pico de memory.current |
| Backend Node | RSS de /proc/PID/status para ese proceso, ligado a identidad y nacimiento actuales | No equivale al conjunto de hijos, heap JS ni memoria total de su cgroup |
| Otros consumidores/Windows | Inventario por comm y RSS sin argumentos; margen del host Windows si comparte presión física | Inventario actual no recuperado; RAM/commit de Windows no medidos |

No sumar WSL y Docker como reservas independientes ni sumar RSS compartida como
si toda fuera memoria física exclusiva. Docker CLI en Linux descuenta caché al
mostrar uso; no equivale a memory.current bruto ni a memoria disponible del host.
Véase [documentación de docker stats](https://docs.docker.com/reference/cli/docker/container/stats/).

En cgroup v2, current representa uso contabilizado, max el techo y events los
eventos de presión/OOM. Un límite efectivo puede venir de un ancestro. Un pico
histórico de memory.peak no aísla esta prueba y no debe resetearse para medirla.
Si faltan archivos/controladores, marcar NV. Estas fuentes están descritas en
la [documentación del kernel](https://docs.kernel.org/admin-guide/cgroup-v2.html).

La presión se evalúa combinando mínimo MemAvailable en cada dominio necesario,
crecimiento/actividad de swap, PSI y eventos de cgroup/kernel con síntomas de los
servicios. Un número bajo de docker stats o CPU inactiva no acredita capacidad.
Si no se puede observar el dominio que puede agotar memoria, NO-GO para iniciar.
No cambiar límites, swap, configuración WSL o rutas de cgroup para conseguir datos.

## Modelo y carga propuesta

Modelo configurado y previsto: **qwen3:8b**. El código local de chat/warmup y
el candidato lo referencian; eso no prueba su inventario actual. No se llamó
a la API de Ollama, no se leyó contenido privado ni se cargó/descargó modelo.
Cuantización exacta, versión runtime del binario, contexto efectivo, KV cache,
paralelismo real y reparto CPU/GPU actuales: **NO VERIFICADOS**.

El consumo depende de cuantización, contexto, caché KV, paralelismo y backend de
inferencia. Tamaño en disco no equivale a pico RAM; si hay GPU también debe
observarse su VRAM mediante una herramienta de lectura existente. La muestra en
reposo no predice carga. La [FAQ oficial](https://docs.ollama.com/faq) relaciona
contexto/paralelismo con memoria. No se extrapolan valores por defecto publicados
a la instalación actual sin verificarlos.

La API documenta opciones de generación y las referencias oficiales describen
num_ctx y num_predict: [API](https://docs.ollama.com/api/generate) y
[parámetros](https://docs.ollama.com/modelfile). Su compatibilidad con el runtime
local deberá acreditarse antes de probar. No instalar/actualizar para resolverla.

## Propuesta de UNA prueba futura — requiere autorización nueva

Este apartado es una especificación, sin comando de envío, JSON ejecutable,
script, bucle de carga ni tarea automática. Nada se ejecuta en esta fase.

1. **Objetivo:** medir presión y pico observado de una generación corta en el
   Ollama existente. No validar rendimiento general ni la ruta OpenCode/Gateway.
2. **Entorno:** cliente local ya disponible hacia el loopback de Ollama, sin
   proxies, OpenCode, workspace privado o credenciales. Contenedores y límites
   existentes, sin cambios. La autorización debe identificar al operador,
   responsable de observación, duración, presupuesto y alcance de cancelación.
3. **Preflight obligatorio:** recuperar una línea basal fiable y entregada antes
   de iniciar. Identificar versión/modelo/variante local y sus parámetros mediante
   metadata segura existente, sin warmup o generaciones de descubrimiento.
   Confirmar espacio, integridad del entorno, dominios observables y umbrales.
4. **Ausencia de incompatibilidades:** acreditar que no compiten solicitudes,
   continuaciones, warmup o CLI externos y que no aparecerán durante la prueba.
   No requiere instalar la barrera rechazada; si no hay evidencia suficiente,
   no empezar. Una muestra vacía no acredita exclusividad. No parar servicios.
5. **Cancelación antes de empezar:** confirmar en la versión instalada un método
   existente para cancelar solo esta request y comprobar su fin del lado servidor.
   Cerrar socket/abortar cliente es una acción local, no evidencia de terminación
   remota ni de carga/modelo liberados. Si esa garantía falta, NO-GO. No crear
   otro verificador ni usar una inferencia extra para ensayarla sin autorización.
6. **Carga única propuesta:** prompt público y sintético «Responde con una sola
   palabra: LISTO». Un request, sin historial, herramientas, imágenes, paralelismo
   del cliente ni reintentos. Proponer num_predict=32 y num_ctx=1024 únicamente
   si el runtime/modelo admiten y aplican esos parámetros y el presupuesto cubre
   también cualquier razonamiento interno. Si no se verifica, no sustituirlos por
   valores ilimitados ni cambiar la configuración global. Esta carga reducida no
   representa el contexto/concurrencia reales del reviewer.
7. **Residencia:** conservar política existente; no enviar requests vacías, unload,
   keep_alive=0 ni cambios de configuración para forzar liberación. Registrar
   si estaba frío/residente con evidencia; no asumirlo por memoria baja. Si la
   política actual mantiene el modelo residente, prever esa memoria en recuperación.
8. **Duración propuesta:** ventana máxima 180 s: basal 30 s, request máximo 60 s
   incluyendo carga, y recuperación hasta 90 s. Son límites a aprobar, no comandos
   de timeout ni prueba de cancelación. Llegar al límite cancela solo la request
   por el método validado, no el servicio. No ampliar tiempos para obtener PASS.
9. **Resultado:** guardar solo metadata técnica de la prueba: tiempos, contadores,
   parámetros efectivos, estado final del stream, resultado y memoria. No logs de
   sesiones, cuerpos completos, prompts privados ni variables de entorno.
10. **Cierre:** verificar servicios, identidad de contenedores, redes/mounts,
    límites, OOM/reinicios y recuperación. No generar una segunda request para
    comprobar funcionamiento. Cualquier prueba funcional adicional requiere otra
    autorización; no reabrir servicio ni ejecutar cutover con este protocolo.

La prueba directa no atraviesa el Gateway. Mantener 110 s OpenCode, 120 s
execFile y 105 s por request Gateway como límites productivos independientes;
no se modifican ni se atribuyen a este cliente directo. No usar 240 s.

## Umbrales propuestos: conservadores, aún NO aprobados

No hay línea basal numérica válida de esta fase para calibrarlos. Se basan en
el techo configurado de 9,71 GiB y en reservar margen, no en un pico observado
del modelo. Son propuestas sujetas a aprobación y pueden ser insuficientes.

| Condición | Propuesta previa a autorización | Justificación y acción |
|---|---|---|
| Margen antes de empezar | En cada dominio relevante, MemAvailable al menos max(2 GiB, 20 % de su total), más estimación revisada del incremento del modelo y 256 MiB reservados al futuro Gateway | Piso de reserva, no capacidad garantizada. Si falta estimación o margen observable: NO-GO; 2 GiB por sí solos no autorizan |
| Margen durante prueba | Abortar si MemAvailable cae por debajo de max(1 GiB, 10 % del total del dominio) | Preservar reserva y evitar esperar al OOM; puede haber picos entre muestras |
| Swap | Abortar con aumento neto de SwapUsed de 64 MiB en 10 s o 256 MiB desde basal; revisar también pswpout/pswpin | Señal temprana propuesta de paginación; no es límite universal de rendimiento |
| Presión PSI | Detener ante full avg10 >=1 % o degradación observable, aun sin alcanzar el piso de RAM | Propuesta sensible para una prueba corta; requiere PSI basal válido en el dominio correcto |
| OOM/reinicios | Cualquier incremento de oom/oom_kill relevante, OOMKilled=true, cambio de generación o contador de reinicios | FAIL inmediato; no reiniciar para continuar ni borrar contadores |
| Operación/observación | Backend pierde listener/proceso, tercero afectado, tarea incompatible, cambio de límites/redes o pérdida de métricas críticas | Abortar; observación incompleta no permite certificar seguridad |
| Tiempo/cancelación | Request llega a 60 s o cancelación no puede confirmarse | Sin retry; estado incierto y NO-GO para nuevas cargas |

No reservar memoria realmente ni ajustar límites en esta fase. La reserva de
256 MiB es contable para la evaluación futura; la prueba sin Gateway no mide
su consumo, tmpfs, overhead ni competencia real. No prometer reacción antes de
un OOM abrupto: la monitorización es observación, no aislamiento de recursos.

## Observación futura y captura de picos

Antes de ejecutar, aprobar un método temporal acotado que entregue cada muestra
inmediatamente; no acumular toda la evidencia hasta un resumen final. Los nombres
de procesos pueden contener espacios: lectura de /proc por campos identificados
o salida estructurada, nunca posiciones ambiguas de ps. No se crea ese método aquí.

- Host Linux/WSL y backend: recomendación de lectura cada 1 s. Usar meminfo,
  /proc/pressure/memory, deltas de vmstat y status ligado a identidad actual.
- Docker: docker stats --no-stream con formato acotado para ambos servicios,
  cada 3–5 s si la latencia lo permite; registrar comienzo/fin y desfase real,
  sin solapar consultas. No prometer frecuencia de 1 s con un comando más lento.
- Si existe acceso de lectura ya aprobado a cgroups del dominio Docker, tomar
  current/stat/events y límites de ancestros. Sin él, señalar qué métricas ofrece
  Docker y cuáles faltan; no inventar equivalencia ni usar docker exec.
- Registrar mínimo MemAvailable por dominio, máximo de uso muestreado de ambos
  contenedores, máximo RSS backend, delta máximo de swap y contadores OOM.
  Comparar solo cada serie consigo misma; no sumar máximos de instantes distintos.
- Estado/identidad/límites al inicio, al final y al detectarse anomalía. Usar reloj
  monotónico para duración y UTC para correlación, sin publicar PID o IDs completos.
- Recuperación hasta 90 s: observar márgenes, presión y procesos/servicios. El
  modelo puede seguir residente; no exigir retorno exacto al RSS previo ni afirmar
  liberación por CPU baja. Un nuevo nivel estable debe estar explicado y conservar
  márgenes; sin explicación o sin estabilización, INCONCLUSIVE y no más cargas.

Comandos unitarios de observación disponibles como referencia, no un recolector
ni una prueba automática; no se repiten ahora las tres muestras de utilización:

```text
cat /proc/meminfo
cat /proc/pressure/memory
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' opencode ollama
docker info --format '{{.MemTotal}}'
ss -H -ltnp
```

No registrar argumentos de procesos, entornos, sesiones o directorios privados.
Si se autorizan logs futuros, usar ubicación privada nueva con permisos
restrictivos; no escribir en los HOME, respaldos existentes o repositorio.
Finalizar y comprobar salida del observador al límite; no dejar daemon/listener.
El máximo muestreado es un **pico observado**, no el máximo físico garantizado.

## Aborto y resultados: cuatro dimensiones separadas

Ante umbral o anomalía: no enviar más requests; cancelar exclusivamente el
cliente/request identificado con el mecanismo validado y conservar metadata.
No usar docker kill/stop, pkill, killall ni señales genéricas a servicios
compartidos. Si no puede confirmarse fin remoto, declarar incertidumbre, continuar
solo observación pasiva hasta el límite y escalar al operador; no declarar
recuperación ni arrancar otra carga. No alterar datos para conseguir normalidad.

| Dimensión | PASS | FAIL / INCONCLUSIVE |
|---|---|---|
| A. Recursos | Series completas, pico observado registrado, márgenes aprobados respetados, sin OOM/reinicios/degradación y recuperación explicada | FAIL por umbral/daño; INCONCLUSIVE por métricas ausentes, picos no atribuibles o recuperación desconocida |
| B. Inferencia funcional | Única request completada con éxito y terminación final válida del formato nativo, dentro del presupuesto; metadata de tokens/duración registrada | Error/timeout: FAIL; cierre ambiguo: INCONCLUSIVE. No esperar [DONE] SSE de un formato nativo diferente |
| C. Seguridad operativa | Autorización, ausencia de incompatibilidades, cancelación comprobable y entorno conservado | Conflicto/cambio: FAIL; exclusividad o fin remoto no verificables: INCONCLUSIVE y NO-GO |
| D. Gateway/OpenCode | NO EVALUADO | No se declara PASS ni se extrapola al reviewer, parser, SSE del Gateway o frontal isolated |

PASS global de esta prueba exige A+B+C PASS, sin ocultar D NO EVALUADO. Un PASS
solo caracteriza esa carga única y esos parámetros. FAIL/INCONCLUSIVE bloquean
conclusiones de capacidad y nuevas ejecuciones hasta decisión humana.

## Bloqueadores independientes y decisión de esta fase

Una inferencia futura exitosa no resolverá cierre de admisiones, exclusividad
remota, descendientes, invocaciones externas, supervisión/relanzamiento del backend,
cutover de OpenCode, aceptación de la ruta completa ni NIVEL 2 estricto.
Respaldos principal/historial y HOME preparados se conservan; no se recrean.

**5B.11D: preparación documental realizada; medición basal NO COMPLETADA por
fallo de recuperación del recolector. NO-GO para solicitar ejecución inmediata
de inferencia sobre este registro incompleto.** Además quedan por acreditar
dominio Docker observable, parámetros locales, cancelación y ausencia de trabajo
incompatible. No se modifican los criterios para saltar esas puertas.

**Próxima acción única:** solicitar autorización separada para una nueva toma
pasiva limitada a tres muestras, con entrega incremental y lector robusto de
campos, sin generación. Esta fase no la repite. Tras disponer de evidencia válida
y cumplir las demás precondiciones, podrá solicitarse una autorización nueva,
explícita y acotada para la única prueba propuesta; nunca queda implícita aquí.

No hubo inferencia, benchmark, docker exec, cambios de servicios/redes, HOME,
respaldos, promoción o Git. No se ejecutaron suites ni scripts operativos.

Verificación final pasiva: identidad, imagen, StartedAt, estado, redes, puertos
y mounts de ambos contenedores coinciden con la metadata registrada durante
esta fase. Los mounts se compararon por destino con estructura normalizada;
la comparación inicial de serializaciones sin normalizar no coincidía y no se
interpretó como cambio estructural. Inventarios de contenedores/redes conservados.
Backend mantiene proceso y listener; HOME preparado, metadata de raíz del anterior
y ambos respaldos conservan las comprobaciones privadas registradas. No se leyó
contenido de sesiones del HOME anterior. El observador de tres muestras terminó
con error y no dejó un monitor activo. Solo se creó este informe; los archivos
versionados y el índice permanecen sin cambios. Whitespace y Markdown revisados.

## Resultado de medición basal 5B.11D.1

**Medición recuperada: 3 intentos, 3 muestras válidas, 0 campos requeridos
fallidos.** Fecha: 10 de noviembre de 2026 UTC (9 de noviembre local,
America/Guatemala). Esta sección completa la línea basal que no pudo recuperarse
en 5B.11D; conserva íntegro el registro anterior del fallo. No reescribe el
protocolo ni convierte sus umbrales propuestos en valores aprobados.

### Método y trazabilidad

Cada muestra se ejecutó en una llamada independiente y su resultado se entregó
antes de iniciar la siguiente. No se guardaron únicamente en un resumen final.
Se usaron /proc/meminfo y /proc/PID/status por claves, stat para identidad y
nacimiento, ss para vincular el listener loopback 3001 con su único proceso Node,
y JSON estructurado de Docker. No se analizaron posiciones de columnas de ps
ni se leyeron argumentos, entornos o sesiones.

Cada campo numérico se validó por separado y con unidad explícita. SwapUsed se
calculó solo tras validar SwapTotal y SwapFree; se comprobaron rangos y unidades
de las cantidades Docker. Los datos Docker se conservan con la precisión
redondeada que entrega el CLI, sin atribuir precisión adicional al cálculo.

Hubo una espera explícita de al menos 5 s después de publicar cada resultado;
la orquestación y las consultas añadieron tiempo. Los intervalos reales entre
inicios fueron 52,084 y 60,446 s. Cada muestra duró aproximadamente 2,45 s y sus
componentes no son simultáneos. Ventana: 00:58:02.249–00:59:57.208 UTC.
No se tomó una cuarta muestra ni se realizó request HTTP.

### Muestras y unidades

MemAvailable, RSS y uso Docker en **MiB**; swap usado en **KiB**.
Hora UTC de inicio; fecha UTC común: 2026-11-10.

| Muestra | Hora UTC | MemAvailable (MiB) | Swap usado (KiB) | Backend RSS (MiB) | OpenCode (MiB) | Ollama (MiB) | Validación |
|---|---|---|---|---|---|---|---|
| 1 | 00:58:02.249 | 7641.48 | 168 | 76.88 | 552.80 | 29.95 | PASS |
| 2 | 00:58:54.333 | 7608.86 | 168 | 76.88 | 552.20 | 28.81 | PASS |
| 3 | 00:59:54.779 | 7544.96 | 168 | 76.88 | 554.00 | 29.06 | PASS |

Constantes verificadas en las tres muestras:

- MemTotal Linux: **10 180 288 KiB = 9,70868 GiB**.
- SwapTotal: **8 388 608 KiB = 8 GiB**.
- SwapFree: **8 388 440 KiB**; SwapUsed: **168 KiB = 0,1640625 MiB**.
- RSS backend original en KiB: 78 724, 78 728 y 78 728.
- MemAvailable original en KiB: 7 824 880, 7 791 472 y 7 726 044.
- Docker Engine: **10 424 614 912 bytes = 9,70868 GiB**, cgroup v2/cgroupfs.
  El CLI muestra un límite redondeado de 9,709 GiB. Que coincida con MemTotal
  Linux no acredita por sí solo una reserva independiente ni margen libre Docker.
- Ambos contenedores: Memory=0, MemoryReservation=0, MemorySwap=0; sin límite
  ni reserva individual configurados. MemorySwap=0 no equivale a swap libre cero.

El backend se identificó inequívocamente por el listener 127.0.0.1:3001, nombre
Node e identidad/nacimiento comprobados antes/después de leer RSS. Conservó
la misma identidad durante las tres muestras y estado S (sleeping).
No se publican su PID ni su marca de inicio.

OpenCode y Ollama conservaron sus identidades frente al baseline anterior
comparado internamente, así como generación, imagen, redes, mounts y puertos
entre muestras. Ambos running, OOMKilled=false y RestartCount=0 en las tres.
No se ejecutaron comandos dentro de contenedores ni pruebas funcionales.

### Estadísticas de reposo y presión observada

- **MemAvailable mínimo: 7 544,96 MiB = 7,36813 GiB**.
- **Swap usado máximo: 168 KiB**, sin crecimiento entre muestras.
- **RSS backend máximo: 76,8828125 MiB**.
- **OpenCode máximo observado: 554,00 MiB**.
- **Ollama máximo observado: 29,95 MiB**.

Son máximos de muestras pasivas en reposo, no picos de inferencia ni una medición
continua. MemAvailable cayó 96,52 MiB entre primera y última muestra; no se
atribuye la variación a un servicio ni se extrapola su tendencia.

PSI de memoria Linux: some/full avg10, avg60 y avg300 = 0,00 en las tres muestras;
sus acumulados no cambiaron. vmstat mantuvo pswpin=6, pswpout=42 y oom_kill=0.
No se observaron nuevas operaciones de swap, eventos OOM del kernel consultado,
OOMKilled ni reinicios durante esta ventana. Esto no acredita el histórico
completo ni el dominio interno del Engine. Los datos son consistentes en unidades
y comparables entre muestras; no hubo errores de validación. No se observaron
indicadores de presión de memoria en este dominio y durante este intervalo,
sin afirmar ausencia universal de actividad o presión en otros dominios.

### Comparación con 5B.11A y umbrales propuestos

| Métrica | Referencia histórica 5B.11A | Observación actual 5B.11D.1 |
|---|---|---|
| MemAvailable Linux | 7,47 GiB | 7,36813–7,46239 GiB |
| Swap usado | 84 KiB | 168 KiB; constante en la nueva ventana |
| RSS backend | 76,7 MiB | 76,87891–76,88281 MiB |
| OpenCode | 517,4 MiB | 552,20–554,00 MiB |
| Ollama | 106,7 MiB | 28,81–29,95 MiB |
| Límite visible Docker | Aproximadamente 9,71 GiB | Mismo valor configurado visible |

No se deduce del menor uso de Ollama si el modelo está cargado o descargado.
La diferencia de swap entre fases no es crecimiento durante esta medición.
Los cambios de consumo no demuestran una causa ni un pico futuro.

Para MemTotal observado, el piso preliminar max(2 GiB, 20 %) es 2 GiB y el mínimo
actual de WSL lo supera. **Eso no satisface el preflight completo:** siguen
faltando la estimación revisada de incremento del modelo, la reserva contable
del Gateway y el margen observable en cada dominio necesario. No se suman WSL
y Docker como pools independientes.

No hubo variación neta de swap ni actividad adicional en los contadores
consultados. La cadencia real no reproduce la vigilancia a 10 s propuesta para
una prueba futura; no se declara validado un mecanismo de aborto rápido.
La presión bajo carga, el umbral de 1 GiB durante generación, la recuperación
y el presupuesto Gateway 256 MiB/0,5 CPU siguen sin evaluarse. Ningún umbral se
modifica ni aprueba en esta fase.

### Campos no verificados y condiciones futuras

Las métricas requeridas de esta recuperación fueron válidas. Continúan
NO VERIFICADOS el MemAvailable/swap internos del dominio Docker, los cgroups
brutos y sus eventos efectivos/ancestros, la RAM/commit de Windows y la VRAM
si corresponde. No se inventa un inventario de otros consumidores. La línea
basal recuperada no determina cuantización, contexto/KV cache, paralelismo,
residencia ni pico de qwen3:8b.

Se revisó únicamente el procedimiento documental de cancelación ya propuesto:
cerrar el cliente no confirma automáticamente fin de la generación remota.
No se ejecutó una request ni se acreditó un mecanismo nuevo. Sin evidencia
segura de cancelación y fin del lado servidor, la ejecución real sigue NO-GO.
No se añaden verificadores, barreras ni mecanismos alternativos.

Antes de una futura autorización deben satisfacerse las puertas existentes:
metadata local y parámetros compatibles, observabilidad suficiente, márgenes y
umbrales aprobados, ausencia de trabajos incompatibles, cancelación comprobable,
plan de observación acotado y autorización humana nueva y explícita.

### Decisión y conservación

- **GO DOCUMENTAL:** medición basal recuperada y documentada.
- **CONDITIONAL GO para preparar una solicitud futura condicionada**, adjuntando
  esta evidencia y las precondiciones pendientes. No equivale a autorización
  para ejecutar ni a suficiencia de recursos bajo carga.
- **NO-GO para ejecutar inferencia ahora**; la cancelación/terminación remota
  y las otras precondiciones siguen sin acreditarse.
- **META A permanece NO-GO PRODUCTIVO.** Gateway no desplegado; NIVEL 2 estricto
  no declarado. No se desbloquean admisión, exclusividad remota, descendientes,
  supervisión/relanzamiento ni cutover por estas cifras.

Siguiente paso único: revisión humana del preflight pendiente del protocolo,
con evidencia de cancelación y fin remoto antes de considerar autorización de
la prueba real. No repetir la medición ni generar carga automáticamente.

Verificación final de 5B.11D.1: contenedores, identidades/generaciones, límites,
redes, mounts y puertos conservados respecto a la primera muestra. Backend
conserva identidad y listener. Inventarios de contenedores/redes, hashes del HOME
preparado y ambos respaldos coinciden con el registro previo; del HOME anterior
solo se contrasta metadata de raíz y referencia de montaje, sin leer sesiones.
Los tres recolectores terminaron, sin procesos de monitoreo pendientes. Solo se
amplió este informe; no hubo cambios versionados ni staging, inferencia, requests
HTTP, docker exec, instalaciones, reinicios, benchmarks o cutover.

## Revisión de factibilidad 5B.11E

Auditoría pasiva del 10 de noviembre de 2026 UTC (9 de noviembre local,
America/Guatemala). HEAD e465b9f, main; sin staging ni cambios versionados.
Se conserva todo el protocolo y el registro del fallo de 5B.11D. No se repitió
la serie de tres muestras de 5B.11D.1 ni se ejecutó inferencia.

**Decisión única: B — NO-GO para solicitar la ejecución de una prueba real
con las garantías actualmente acreditadas.** La recuperación basal sigue
siendo GO documental; el CONDITIONAL GO anterior para preparar una solicitud
no significa que su preflight haya pasado. Esta revisión identifica faltantes
concretos, sin reabrir gates, barreras o contratos remotos de OpenCode.

### Recursos: verificado y pendiente

Se hizo una consulta puntual de docker stats para atribución actual, junto a
metadata de límites; no otra serie basal ni prueba de carga. Los resultados
no se mezclan con los máximos de 5B.11D.1:

| Dato | Evidencia de 5B.11E | Alcance |
|---|---|---|
| Memoria global visible Docker | 10 424 614 912 bytes, aproximadamente 9,71 GiB | Total visible, no RAM disponible ni reservada exclusivamente |
| Cgroups | v2, driver cgroupfs; namespace de contenedor privado | No expone la jerarquía completa del host Docker |
| OpenCode | 588 MiB / límite visible 9,709 GiB; CPU 4,03 % | Vista CLI redondeada de un instante, no pico |
| Ollama | 29,8 MiB / límite visible 9,709 GiB; CPU 0,00 % | No acredita modelo descargado ni ausencia completa de solicitudes |
| Ambos contenedores | Memory=0, MemoryReservation=0, MemorySwap=0, CgroupParent vacío | Sin límites/reservas individuales explícitos; no significa memoria infinita o swap disponible cero |
| Estado | Ambos running, OOMKilled=false, RestartCount=0 | Metadata puntual; no validación funcional por generación |
| GPU de Ollama | DeviceRequests solicita capacidad gpu | No acredita dispositivo disponible, VRAM libre ni reparto efectivo CPU/GPU |

El techo configurado individual está identificado como no establecido. El
**límite efectivo heredado de ancestros y el margen disponible dentro del
dominio Docker siguen NO VERIFICADOS**, al igual que su swap efectivo. No se
accedió a esos cgroups desde dentro de los contenedores. La cifra del Engine y
el límite mostrado por stats no demuestran por sí solos la jerarquía efectiva.

MemAvailable mínimo 7,36813 GiB y swap constante 168 KiB pertenecen a la línea
basal anterior de WSL, no a una medición nueva ni a una garantía para Docker.
Las reservas no se suman. El backend y otros consumidores comparten recursos;
el crecimiento entre consultas no puede atribuirse sin una serie correlacionada.
No se ha medido pico de qwen3:8b ni VRAM. Gateway 256 MiB/0,5 CPU sigue siendo
presupuesto candidato y no participa en esta prueba directa.

### Metadata local del modelo y runtime

Primero se revisaron configuración y documentación locales, sin consultar
endpoints de Ollama. El mount del servicio es un volumen cuyo origen no es
directamente visible desde este Linux. No se copió, montó ni inspeccionó su
contenido mediante otro transporte para superar esa limitación.

| Propiedad | Resultado |
|---|---|
| Nombre previsto | qwen3:8b confirmado en configuración local; inventario actual no consultado |
| Versión de Ollama | 0.30.8 consta en la cadena histórica de docs/14_SECURITY_STATUS.md; no vinculada de nuevo al binario en ejecución |
| Etiqueta de imagen | El valor OCI version observado es 24.04 y no se acepta como versión del binario Ollama; no hay etiqueta de revisión utilizable |
| Tamaño/identidad del modelo y cuantización | NO VERIFICADOS actualmente; el nombre del tag no los demuestra |
| Contexto, paralelismo, KV cache y límite efectivo de generación | NO VERIFICADOS; no hay valores declarados en las variables seleccionadas de configuración del contenedor |
| Keep-alive | Chat/warmup del backend envían 1h en su código; no prueba la política efectiva de una futura request directa |
| CPU/GPU efectivos y residencia actual | NO VERIFICADOS; solicitar GPU y observar poca memoria/CPU no demuestra colocación o residencia |

La consulta de variables se limitó a OLLAMA_NUM_PARALLEL, OLLAMA_CONTEXT_LENGTH,
OLLAMA_MAX_LOADED_MODELS, OLLAMA_KEEP_ALIVE, OLLAMA_KV_CACHE_TYPE,
OLLAMA_FLASH_ATTENTION y OLLAMA_LOAD_TIMEOUT. No estaban declaradas allí;
no se imprimieron otros valores de entorno ni se dedujeron defaults efectivos.
El backend no fija num_ctx/num_predict en los transportes de chat/warmup
revisados. Los valores 1024/32 del protocolo siguen siendo propuestas sin
compatibilidad local acreditada. Tamaño en disco y uso en reposo no predicen RAM.

### Contrato de cancelación: cuatro hechos diferentes

Se revisaron fuentes oficiales públicas, sin autenticación Git ni ejecución
de sus ejemplos. La versión histórica sirvió solo para seleccionar el tag;
no se presume identidad entre ese código y la instalación actual.

| Etapa | Evidencia y límite |
|---|---|
| A. Cancelar cliente | El código local utiliza AbortController para cancelar fetch. Un cliente dedicado podría abortar únicamente su propia request; no se ejecutó ni aprobó ese cliente aquí |
| B. Interrumpir generación | En el tag oficial v0.30.8, GenerateHandler pasa c.Request.Context() a Completion. El cliente interno usa ese contexto y contempla cancelación. Es evidencia del mecanismo previsto, no prueba de terminación acotada en esta instalación |
| C. Confirmar fin del consumo de generación | No se acreditó una confirmación observable ligada a esta request después del aborto. Fin del cliente, CPU baja, memoria estable o inventario de modelos no bastan por sí solos |
| D. Conservar/liberar modelo | Keep-alive regula residencia y es independiente del fin de generación; cancelar no demuestra descarga ni requiere descargarlo |

Fuentes del mecanismo previsto: [GenerateHandler v0.30.8](https://github.com/ollama/ollama/blob/v0.30.8/server/routes.go)
y [Completion v0.30.8](https://github.com/ollama/ollama/blob/v0.30.8/llm/llama_server.go).
La propagación es una inferencia de esas rutas de código; no se auditó
exhaustivamente el motor interno ni se demuestra aquí su comportamiento al
cancelar durante carga, prefill o generación. No se extrapola a todos los backends.

La [API oficial de generación](https://docs.ollama.com/api/generate) describe
done/done_reason para respuestas completadas. Tras desconectar no se puede
presuponer recepción de esa evidencia. En la documentación revisada no se
identificó un acuse de cancelación por request que se haya vinculado y validado
en esta instalación. No se inventa un endpoint o un identificador de control.
La [FAQ oficial](https://docs.ollama.com/faq) distingue la residencia mediante
keep_alive. No se propone cambiarlo a cero ni descargar modelos como aborto.

### Aborto futuro limitado a la request — todavía no habilitado

El único candidato es el aborto del transporte del cliente dedicado a esa
solicitud, con cierre de su lector/conexión y sin afectar otros clientes.
Hace falta vincular la versión real con el contrato de cancelación y una
observación existente que permita confirmar fin de esa generación en un plazo
acotado, bajo ausencia de carga incompatible. El cierre local solo acredita A.

Mientras B/C no estén suficientemente acreditados, **no iniciar la request**.
Un timeout de cliente o num_predict finito no sustituye esa evidencia. Si una
prueba futura ya autorizada encontrara incertidumbre, detener nuevos envíos,
conservar metadata y escalar al operador; no declarar recursos liberados.
No usar docker stop/kill, pkill, killall, reinicio de Ollama/Docker ni una
operación de descarga de modelo como abortos ordinarios. No se implementa otro
verificador remoto ni un mecanismo nuevo de cancelación.

### Preflight específico antes de cualquier autorización futura

1. Consentimiento humano nuevo y explícito para una sola request directa,
   sintética, sin retries; alcance de parámetros, tiempo y aborto revisado.
2. Metadata fiable del runtime/modelo ya existentes: versión vinculada a la
   imagen/binario, variante/tamaño/cuantización, parámetros efectivos y soporte
   de los límites propuestos. Sin descargas, warmup ni cambios de configuración.
3. Límite/margen y swap del dominio efectivo observables; VRAM si interviene GPU.
   Renovar métricas justo antes de una eventual prueba autorizada y aprobar
   umbrales con margen para la carga; no reutilizar la cifra basal como garantía.
4. Backend disponible por listener/proceso, contenedores estables, sin OOM ni
   reinicios nuevos y sin cambios de límites, imágenes, redes o mounts.
5. Ausencia de carga incompatible conocida de Ollama, incluidos warmup, chat,
   continuaciones y CLI externos; acuerdo operativo concreto durante esa request.
   No se exige ni se autoriza una parada del backend o ventana de cutover.
   Si no puede acreditarse un entorno razonablemente controlado, NO-GO.
6. Medio existente de cancelación y confirmación de fin ligado a la request,
   sin detener servicios compartidos. Si falta evidencia, NO-GO antes de enviar.
7. Observación temporal revisada, salida incremental, vigilancia de umbrales,
   comprobación posterior de actividad/residencia y metadatos privados nuevos
   únicamente si se autorizan. Ningún monitor permanente ni acceso a datos privados.

Esta lista es una condición futura, no constancia de que se haya satisfecho.
Los umbrales y duraciones originales no se amplían ni se aprueban en 5B.11E.

### Decisión cerrada y evidencia mínima para reconsiderarla

**NO-GO.** Falta una garantía indispensable para el aborto controlado: evidencia
de interrupción y confirmación de fin de la generación concreta en el runtime
instalado. Además permanecen sin verificar el margen/límite efectivo de recursos
y la metadata que permita estimar y acotar la carga. No se confunde esta carencia
con demostrar un fallo actual de Ollama.

Para reconsiderar se necesita un expediente acotado, sin nueva arquitectura:
vinculación verificable del runtime instalado; evidencia de su cancelación por
request y cómo comprobar el fin en un tiempo acotado sin parar servicios;
metadata del modelo y límites/margen observables. Solo entonces revisar los
puntos 1–7. Si la evidencia no existe, mantener NO-GO; no abrir otra línea de
prototipos ni realizar una generación para suplirla con autorización implícita.

**Siguiente paso único:** revisión del operador del expediente mínimo anterior,
aportando evidencia disponible de la cancelación/fin en su runtime antes de
considerar una autorización real. No se solicita ejecutar la inferencia ahora.

El alcance es una posible prueba de recursos de Ollama, no Gateway, reviewer,
OpenCode, parser o aislamiento frontal. Incluso un éxito futuro no desbloquea
admisión/exclusividad, descendientes remotos, supervisión del backend, cutover
o aceptación productiva. META A continúa NO-GO; NIVEL 2 estricto no declarado.
No se modifica promotion/, maintenance/, código, configuración, HOME o respaldos.

