# Estado de Seguridad y Aislamiento de LAB-IA

## 1. Alcance y procedencia de la evidencia

Este documento consolida el estado reportado entre FASE 5B.6 y FASE 5B.9H,
con el código base en `b410fa5 Agregar gateway seguro para OpenCode`.
La FASE 5B.9I es exclusivamente documental: no implementa nuevas protecciones.

**NIVEL 2 completo no está demostrado ni desplegado en producción.**

Se distinguen tres clases de información:

- **Código versionado:** contratos y configuración comprobables en los archivos
  enlazados al final. Describir una protección en código no demuestra su despliegue.
- **Resultados reportados:** ejecuciones e inspecciones temporales descritas en
  los informes de las fases. No se repitieron para escribir este documento.
- **Pendientes:** propiedades que requieren autorización y pruebas adicionales.

Los contenedores, redes, HOME, workspaces, launchers y evidencias temporales de
las pruebas reportadas se eliminaron al terminar. Este documento no incorpora
logs originales ni los reconstruye; las cantidades y resultados siguientes
proceden de los informes de la conversación. No constituye una auditoría
exhaustiva ni una certificación de aislamiento.

Complementa la descripción histórica de las fases 5A y 5B.5 en
[Workspaces externos](13_EXTERNAL_WORKSPACES.md).

## 2. Producción frente a arquitecturas experimentales

### Producción reportada al cierre de 5B.9H

```text
OpenCode productivo ── HTTP directo ──> Ollama productivo
Backend LAB-IA en WSL ── loopback ────> Ollama productivo
```

- El contenedor `opencode` continúa con su configuración original y la red
  `docker_default`. Su provider apunta a
  `http://host.docker.internal:11434/v1`, modelo `ollama/qwen3:8b`.
- Ollama continúa en la red `bridge`, publicado en `127.0.0.1:11434`.
- El backend mantiene sus transportes hacia `http://127.0.0.1:11434`.
- El gateway existe en el repositorio, pero **no está desplegado en producción**.
- Las redes FRONT/TRANSIT isolated y el relay experimental **no están desplegados**.
- Las inspecciones reportadas conservaron ID, StartedAt, estado `running`, redes
  y puertos de los contenedores productivos. No se aplicó una migración productiva.

Estas afirmaciones operativas son el estado reportado en las fases anteriores;
5B.9I no ejecuta una nueva inspección de Docker ni modifica esos componentes.

### Cadena funcional validada temporalmente

```text
OpenCode 1.17.18 / reviewer con herramientas denegadas
    → Gateway original de b410fa5 / Node oficial 22.23.4
    → Ollama 0.30.8
    → qwen3:8b local
```

Se utilizaron imágenes fijadas por digest, no tags flotantes:

| Componente | Imagen utilizada en las pruebas |
|---|---|
| OpenCode | `ghcr.io/anomalyco/opencode@sha256:bf9d0e84b7cedef436a8f57db4d48767cd5d8fc6604f666335c1cc916b199a97` |
| Node | `docker.io/library/node@sha256:9f0dde62d10e7ff7a310ecaebd66225f6b46c17e6cb778449a77b05d3541bea2` |

La imagen Node se descargó de forma autorizada en 5B.8G y se conservó en caché.
Las fases posteriores utilizaron las imágenes locales con `--pull=never`.

## 3. Contrato y límites del gateway existente

`createOpenCodeGateway` devuelve un servidor HTTP sin iniciarlo. Un launcher
selecciona la dirección de escucha y el upstream fijo de operador; los clientes
HTTP no pueden seleccionar otro destino.

| Control de aplicación | Comportamiento en b410fa5 |
|---|---|
| Método y ruta | Solo `POST /v1/chat/completions` |
| Modelo | Exactamente `qwen3:8b` |
| Upstream | Host y puerto configurados por operador; path constante |
| Concurrencia | `maxConcurrent=1` por defecto, sin cola; exceso devuelve `429 BUSY` |
| Headers | Reconstruidos para upstream; no se propagan headers arbitrarios o credenciales del cliente |
| Túneles y redirects | Sin CONNECT ni Upgrade; no se siguen redirects |
| Body | JSON y UTF-8 estrictos, campos y tipos validados, límites de bytes y profundidad |
| Schemas | Rechaza referencias externas y construcciones prohibidas, incluidos `$schema`, `$id` y `$dynamicRef` en schemas |
| SSE | Validación incremental, backpressure, JSON con `choices` y terminación `[DONE]` |
| Cancelación | Errores, timeouts y desconexión del cliente cancelan upstream y liberan el cupo |

El gateway **permite ciertas estructuras válidas de tools y tool_choice** dentro
de su contrato. No debe describirse como un rechazo absoluto de herramientas.
La ausencia de tools en workspace summary depende también de la configuración
efectiva del reviewer.

| Presupuesto original por defecto | Valor |
|---|---:|
| Headers entrantes / body entrante | 10 s / 10 s |
| Headers upstream | 90 s |
| Inactividad upstream | 30 s |
| Total por request | 105 s |
| Body / respuesta no streaming | 2 MiB / 2 MiB |
| Evento SSE / stream completo | 256 KiB / 32 MiB |

Los launchers experimentales conservaron estos límites. Un HTTP 200 inicial no
demuestra por sí solo que el stream finalizó o que OpenCode procesó su contenido.
El resultado funcional exige además cierre correcto, salida procesable y parser PASS.

Estas restricciones son de aplicación. **No impiden que un proceso comprometido
abra sockets distintos si su namespace de red lo permite.**

## 4. Reviewer y workspace summary

El backend entrega un snapshot de solo lectura con la estructura real
`entries`, `files` y `entriesTruncated`. Su prompt exige exclusivamente el JSON
con `tipo`, `elementos`, `proposito` y `limitaciones`. El parser real valida los
eventos de texto y esa estructura de salida.

La configuración inline versionada es:

```json
{"agent":{"reviewer":{"tools":{"*":false},"permission":"deny"}}}
```

Se transmite mediante `OPENCODE_CONFIG_CONTENT`, además de `--pure`,
`--dir /workspace`, `--agent reviewer` y `--format json`. Las pruebas reales
también seleccionaron explícitamente `--model ollama/qwen3:8b`.
El reviewer se copió sin modificaciones desde el archivo versionado.

Las configuraciones temporales mantuvieron `autoupdate=false`, `share=disabled`,
`enabled_providers=["ollama"]` y las variables:

- `OPENCODE_DISABLE_AUTOUPDATE=true`
- `OPENCODE_DISABLE_MODELS_FETCH=true`
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`

Solo se sustituyó el baseURL temporal para dirigir OpenCode al gateway.
Esos ajustes reducen actividad automática, pero no son un bloqueo de red.

Una invocación de OpenCode puede generar más de una llamada al modelo. La
inspección estática reportada en 5B.8J identificó generación auxiliar de título
concurrente y políticas de retry. Los mocks lentos y las pruebas reales
mostraron recuperación tras `429 BUSY` sin ampliar la concurrencia del gateway.
Los requests rechazados sin evidencia de origen se clasificaron DESCONOCIDOS;
no se demostró que cada 429 correspondiera individualmente al mismo retry lógico.

El arnés autorizado de 5B.8L y 5B.9E admitió una única invocación con máximo
externo de 240 s. Esto **no modificó el backend versionado**, que conserva
`timeout ... 110` para OpenCode y un timeout de 120 s en su llamada `execFile`.
Tampoco modificó los timeouts del gateway.

## 5. Historial de pruebas y diagnósticos reportados

| Fase | Resultado y alcance reportados |
|---|---|
| 5B.6 | Antecedente de preparación sanitizada y diagnóstico de compatibilidad del payload, incluidos tools y schemas. No se reproducen aquí payloads ni cifras no disponibles de esa fase. |
| 5B.7 | Reviewer real → gateway → mock: dos requests aceptados, exit 0 y parser PASS; flujo con herramientas denegadas usado como referencia posterior. |
| 5B.8 | Integración inicialmente bloqueada antes de inferencia por el camino de conectividad elegido y ejecución del loader temporal. No demostró fallo del gateway. |
| 5B.8A–5B.8D | El loader copiado carecía de permiso ejecutable; corregirlo permitió `node --version`, pero no bastó para completar el runtime. La prueba de importación abortó por un builtin externalizado ausente. El listener loopback de Node WSL no fue alcanzable mediante `host.docker.internal` desde Docker Desktop. |
| 5B.8E–5B.8G | Diseño del runtime dedicado, identificación del manifiesto oficial linux/amd64 y descarga única autorizada de la imagen Node fijada. |
| 5B.8H | Node oficial + gateway real + mock local, con `network=none`: SSE y denegaciones correctos, sin Ollama real. |
| 5B.8I | Una invocación produjo seis POST, dos aceptados y cuatro 429. Se detuvo el cliente: primer stream 200/OK y segundo cancelado, sin summary final procesable. La cancelación no demuestra incompatibilidad definitiva. |
| 5B.8J | Análisis de concurrencia, título auxiliar, retries y límites; no se modificó gateway. |
| 5B.8K | Mock lento: seis POST, dos aceptados y cuatro 429; título ocupó el cupo unos 16 s. OpenCode exit 0, parser PASS y sin herramientas. |
| 5B.8L | Inferencia real completa: cinco POST, dos upstreams 200 y tres 429 recuperados; exit 0, parser PASS, resumen ficticio y dos streams completos. Duración reportada: 27,988 s. |
| 5B.9A | Diseño de la frontal internal + isolated; no despliegue productivo. |
| 5B.9B | Frontal isolated, gateway dual-homed, mock y canario: conectividad frontal y bloqueo directo hacia upstream; POST sintético SSE correcto. |
| 5B.9C | Negativos directos hacia Ollama, host, upstream y un destino TCP externo sin datos: sin conexión en los controles ensayados. DNS externo `example.com` devolvió SERVFAIL. |
| 5B.9D | Gateway dual-homed alcanzó Ollama mediante GET administrativos, mientras OpenCode permaneció bloqueado hacia los destinos directos ensayados. Sin inferencia. |
| 5B.9E | Inferencia real con frontal isolated: cuatro POST, dos upstreams completos y dos 429 recuperados; exit 0, parser PASS, sin herramientas. Duración reportada: 20,494 s. |
| 5B.9F | Diseño de egress y evaluación del relay; no implementación de políticas. |
| 5B.9G | Gateway sin ruta externa, relay experimental y mock: end-to-end SSE PASS; un request al mock y denegaciones sin upstream adicional. El relay conservó salida convencional. |
| 5B.9H | Inspección de plataforma: backend iptables identificado, sin mecanismo específico de egress completo y reversible validado para el Relay actual; decisión NO-GO para implementar esa prueba en el Desktop compartido. |

Las cifras de POST corresponden a la invocación de OpenCode y sus solicitudes
internas; excluyen controles administrativos y regresiones negativas.

### Evidencia funcional clave: 5B.8L y 5B.9E

Ambas fases reportaron una única invocación principal, inferencia real local con
`qwen3:8b`, salida limitada a `README.md` y `notas.txt` ficticios, ausencia de
eventos de herramientas y parser real PASS. No se repitió manualmente la
invocación dentro de cada prueba.

Los upstreams de inferencia utilizaron exclusivamente
`POST /v1/chat/completions`, `stream=true` y
`stream_options={"include_usage":true}`. Se observaron campos raíz
`model`, `max_tokens`, `top_p`, `messages`, `stream` y `stream_options`;
tools, tool_choice, `$schema` y response_format estuvieron ausentes.

Se reportaron `finish_reason=stop`, `[DONE]`, cierres normales y ausencia de
errores de parsing observados. Los 429 transitorios no se trataron como fallo
definitivo. La regresión posterior obtuvo cuatro 404 para rutas prohibidas y
un 400 por modelo alternativo, sin nuevos upstreams por esas denegaciones.
No se ejecutaron operaciones peligrosas directamente contra Ollama.

## 6. Evidencia de aislamiento frontal

Topología temporal validada con inferencia en 5B.9E:

```text
OpenCode ── FRONT internal + isolated ── Gateway
                                           │
                                  UPSTREAM bridge convencional
                                           │
                              host.docker.internal:11434
                                           │
                                      Ollama existente
```

En los controles reportados:

- FRONT usó `com.docker.network.bridge.gateway_mode_ipv4=isolated`,
  `Internal=true` y IPv6 deshabilitado.
- OpenCode perteneció solo a FRONT; no tuvo ruta IPv4 predeterminada ni rutas
  IPv6 externas observadas. IPv6 loopback no equivale a salida externa.
- OpenCode alcanzó el gateway por alias y por IP frontal: GET `/api/tags`
  devolvió el 404 esperado, distinto de un fallo de conexión.
- El gateway escuchó solo en su IP frontal; no se publicaron puertos temporales.
- El acceso directo por IP a Ollama, al canario activo y a la IP upstream del
  gateway falló con `Network unreachable` en los controles de 5B.9E.
- En 5B.9C, el intento TCP zero-I/O a `1.1.1.1:443` tampoco estableció conexión.
- El canario se verificó desde un origen autorizado; así su inaccesibilidad
  desde OpenCode no se atribuyó simplemente a un destino apagado.

Estos son controles puntuales con rutas e identidades concretas. **No prueban
bloqueo universal de todos los hosts, protocolos, consultas DNS o configuraciones
futuras.** Un resultado DNS fallido no sustituye una prueba por IP, y un puerto
sin listener que devuelve Connection refused no acredita por sí solo aislamiento.

Los temporales conservaron usuario `1000:1000`, rootfs RO, `cap_drop ALL`,
`no-new-privileges`, `pids_limit=256` e init. No montaron Docker socket, SSH,
credenciales, HOME real, bases privadas ni workspace real. Para reviewer se
utilizó HOME sanitizado RW, dependencias locales de soporte ya revisadas y
workspace ficticio RO, sin instalar paquetes.

## 7. Relay experimental de 5B.9G

```text
OpenCode
   │ FRONT: internal + isolated
Gateway
   │ TRANSIT: internal + isolated
Relay experimental: segunda instancia idéntica del gateway
   ├── Mock en 127.0.0.1, upstream fijo del Relay
   └── UPSTREAM: bridge convencional ── Canary activo
```

| Componente temporal | Redes | Listener |
|---|---|---|
| OpenCode, solo cliente HTTP | FRONT | Sin servicio de prueba |
| Gateway | FRONT + TRANSIT | Solo IP de FRONT, puerto 8080 |
| Relay | TRANSIT + UPSTREAM | Solo IP de TRANSIT, puerto 8080 |
| Mock | Loopback del Relay | `127.0.0.1`, puerto efímero |
| Canary | UPSTREAM | Puerto 9090 dentro del contenedor, sin publicación |

Se reportó un POST sintético end-to-end HTTP 200, SSE completo con content,
finish_reason, usage y `[DONE]`, y exactamente un request en el mock. Las cinco
denegaciones del gateway no añadieron requests al relay ni al mock.

El gateway no tenía ruta por defecto. Sus intentos directos al canario, al host,
a la IP upstream del relay y al destino TCP externo ensayado fallaron por falta
de ruta. El relay sí alcanzó el canario y conservó una ruta por defecto upstream.
Ambas instancias mantuvieron `maxConcurrent=1` y los límites originales.

La mejora comprobada fue retirar la salida directa convencional del gateway.
**La salida arbitraria potencial permaneció en el Relay. No se recomienda
incorporarlo a producción por ahora ni añadir otro relay para desplazar el riesgo.**

## 8. Plataforma y decisión de 5B.9H

La inspección de solo lectura reportó:

| Dato | Resultado |
|---|---|
| Docker Desktop | `4.77.0 (228796)` |
| Docker Engine | `29.5.3`, Linux/amd64 |
| Backend reportado por Engine | `FirewallBackend.Driver=iptables` |
| Docker Sandboxes | Cliente y servidor `v0.12.0`, detectados |

No se auditaron reglas iptables/nftables ni se identificó su implementación
subyacente legacy/compatibilidad. Identificar el driver no demuestra cobertura
de cada camino de paquetes.

No se encontró `containersProxy` en la configuración local consultada ni el
archivo local `admin-settings.json`. No se verificó una licencia ni se descartaron
políticas administradas por otra vía. La presencia del proxy interno de Docker
no prueba que el tráfico de contenedores esté sometido a una allowlist.

Las opciones de Docker Sandboxes detectadas pertenecen a sandboxes separados;
no se demostró que pudieran aplicarse al contenedor Relay bridge actual ni que
cubrieran exactamente IP, puerto, DNS y forwarding.

**Decisión de 5B.9H: NO-GO para implementar una prueba de egress estricto en el
Docker Desktop compartido.** No se demostró disponibilidad de una política
específica, completa y reversible para el Relay actual, independiente de que su
código HTTP se comporte correctamente. No se alteraron políticas del equipo.

## 9. Riesgos pendientes y propiedades distintas

| Riesgo o propiedad | Estado y evidencia que falta |
|---|---|
| Egress independiente de Gateway/Relay | Una bridge convencional permite intentar otros sockets. El contrato HTTP no es una allowlist de red. Falta enforcement independiente con controles positivos y negativos en el mismo namespace. |
| Forwarding entre interfaces | Se observó `ip_forward=1` en Gateway y Relay. No prueba tránsito utilizable ni su ausencia. Faltan garantías sobre rutas, recepción de tráfico de tránsito, filtrado y retorno. |
| DNS externo general | `example.com → SERVFAIL` y timeouts de nombres concretos no prueban bloqueo universal ni ausencia de reenvío DNS. |
| Ollama sin Internet | Su red productiva continúa siendo bridge convencional. Usar un modelo local o desactivar cloud no equivale a bloquear su egress. |
| Allowlist IP:puerto | Falta identificar endpoint/origen y destino de forma mantenible, cubrir otros puertos, UDP/DNS, IPv6, destino host y tráfico reenviado. |
| Direcciones dinámicas | Las IP y endpoints pueden cambiar o reutilizarse. Una regla residual o parcial puede afectar otro contenedor o dejar un camino sin cubrir. |
| Producción | No se ha autorizado ni probado la migración persistente a la arquitectura experimental. |
| Frontera administrada independiente | Requiere evaluación separada de control de red, conectividad autorizada a Ollama, mantenimiento y rollback, sin asumir garantías por su nombre. |

`cap_drop ALL` reduce capacidad de cambiar configuración y usar paquetes raw;
no bloquea conexiones ordinarias. `no-new-privileges` limita ganancias de
privilegios mediante exec, pero no es una política de egress. Un proceso
comprometido puede ignorar su lógica HTTP y utilizar sockets disponibles.

Ubuntu WSL, el host del Engine y el backend de red de Docker Desktop son
fronteras distintas. No se ha demostrado que un firewall de Ubuntu controle
todo ese tráfico. Reglas globales sobre Docker Desktop podrían afectar SQL
Server, Ollama y otras aplicaciones; no deben improvisarse.

## 10. Decisión arquitectónica vigente

- Mantener el gateway actual sin modificaciones; su existencia no implica
  despliegue productivo ni egress restringido.
- No añadir nuevos relays ni adoptar el relay experimental en producción.
- No improvisar reglas globales ni cambiar toda la red Docker del equipo.
- No declarar NIVEL 2 completo, funcionamiento offline completo ni Ollama sin Internet.
- Si se exige egress estricto, evaluar una frontera de red administrada
  independientemente y un mecanismo específico, comprobable y reversible.

| Alternativa | Decisión documental |
|---|---|
| Gateway dual-homed con política independiente | Objetivo más simple si llega a validarse enforcement específico y completo. El diseño funcional por sí solo no lo garantiza. |
| Gateway + Relay | Separación experimental demostrada, con riesgo residual trasladado al relay. No recomendado para adopción productiva actual. |
| Entorno aislado administrado independientemente | Próxima evaluación recomendada si el requisito es egress estricto y no puede obtenerse un control seguro en el Desktop compartido. No está seleccionado ni implementado. |

La garantía hoy defendible es aislamiento frontal experimental y compatibilidad
funcional en los escenarios ensayados. Una política de red futura deberá
distinguir conexiones del proceso, forwarding IP, proxy HTTP permitido y DNS.

## 11. Evidencia requerida para una futura aceptación de NIVEL 2

Los siguientes criterios son una propuesta de aceptación, no garantías actuales:

| Propiedad | Evidencia necesaria |
|---|---|
| OpenCode sin bypass | Única red frontal, gateway accesible y pruebas directas por nombre/IP hacia host, Ollama, upstream y destinos externos bloqueadas; rutas e IPv6 coherentes. |
| Destino único del Gateway | Allowlist independiente para el endpoint autorizado y TCP 11434, con retorno necesario; mock permitido activo y destinos/puertos prohibidos activos bloqueados desde el mismo namespace. No basta un 400/404 HTTP. |
| DNS controlado | Política explícita y pruebas correlacionadas de consultas autorizadas y no autorizadas; comprobar que el resolver integrado no ofrece un canal alternativo. |
| Forwarding controlado | Cubrir tráfico originado y reenviado. Ejercitar un camino de tránsito válido o demostrar otra frontera independiente que lo impida; ip_forward y ausencia de ruta local no bastan por separado. |
| Ollama sin Internet | Política y pruebas desde su propio namespace, preservando inferencia local, modelos persistidos y acceso autorizado del backend/gateway. No intentar operaciones peligrosas para medir el bloqueo. |
| Backend funcional | Conservar el endpoint loopback y validar sus flujos autorizados sin convertir al reviewer en cliente privilegiado. |
| Identidad y ciclo de vida | Asociar política a recursos concretos y manejar reasignación de IP sin aperturas; no dejar reglas residuales que alcancen otros contenedores. |
| Rollback probado | Retirar solo política y recursos de prueba, coordinando retirada con liberación de endpoints; preservar imágenes, volúmenes y servicios productivos. |
| Adopción autorizada | Plan y aprobación separados para configuración productiva, persistencia, operación, regresiones y recuperación. Las pruebas temporales no autorizan el despliegue. |

Antes de implementar otra prueba de egress debe identificarse el mecanismo de
enforcement real y su alcance. El NO-GO de 5B.9H sigue vigente mientras no se
resuelva esa condición. Este documento no autoriza comandos de red ni cambios
de producción.

## 12. Fuentes y límites de trazabilidad

Fuentes versionadas revisadas para esta consolidación:

- [Gateway](../proyectos/lab-ia-web/server/opencode-gateway.js) y
  [tests existentes](../proyectos/lab-ia-web/server/opencode-gateway.test.js).
- [Backend: configuración inline, prompt, parser y ejecución de workspace summary](../proyectos/lab-ia-web/server/index.js).
- [Reviewer](../agentes/agents/reviewer.md).
- [Compose productivo](../docker/docker-compose.yml) y
  [configuración de OpenCode](../docker/opencode.json).
- [Chat Ollama](../proyectos/lab-ia-web/server/chat-ollama.js),
  [propuestas](../proyectos/lab-ia-web/server/ollama-proposal.js) y
  [warmup](../proyectos/lab-ia-web/server/ollama-warmup.js).
- [Documentación previa de workspaces y hardening](13_EXTERNAL_WORKSPACES.md).

Los resultados experimentales y metadatos de plataforma provienen de los informes
reportados de 5B.6–5B.9H. No hay en este documento nuevas mediciones, capturas,
logs conservados o afirmaciones de auditoría de reglas de filtrado.

Referencias técnicas consultadas en los análisis previos, que no demuestran
por sí mismas habilitación en esta instalación:

- [Docker: modos gateway e isolated](https://docs.docker.com/engine/network/port-publishing/).
- [Docker: reglas del backend iptables](https://docs.docker.com/engine/network/firewall-iptables/).
- [Docker Desktop: arquitectura de red](https://docs.docker.com/desktop/features/networking/).
- [Docker: DNS de contenedores](https://docs.docker.com/engine/network/).
- [Docker Desktop: air-gapped containers](https://docs.docker.com/desktop/enterprise/hardened-desktop/air-gapped-containers/).
- [Kernel Linux: ip_forward](https://kernel.org/doc/html/latest/networking/ip-sysctl.html).
- [Kernel Linux: no-new-privileges](https://docs.kernel.org/userspace-api/no_new_privs.html).

**Conclusión al cierre de 5B.9H:** compatibilidad real y separación frontal
experimental demostradas para los controles reportados; egress estricto,
forwarding, DNS general y adopción productiva pendientes. No declarar NIVEL 2
completo.
