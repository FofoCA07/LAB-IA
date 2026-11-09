# FASE 5B.10P — ventana B candidata, NO AUTORIZADA PARA PRODUCCIÓN

## Decisión

NO-GO para ejecutar mantenimiento/cutover con los mecanismos productivos actuales.
Hay un ensayo sintético funcional de las puertas necesarias, pero no un adaptador
productivo que pueda cerrar admisión, garantizar exclusividad e inventariar trabajo
remoto. Detener el backend no resuelve por sí solo esos requisitos.

Los módulos window-b.mjs, window-b-fixture.mjs y window-b.test.mjs son un protocolo
candidato y un ensayo; no son un comando de mantenimiento. No tienen destino
productivo por defecto ni código Docker. No integran la barrera A en el backend.
No ejecutar este procedimiento ni los runbooks de promotion/ en esta fase.

## Método de ejecución observado

package.json declara server = node server/index.js. En esta inspección, el listener
loopback 3001 pertenece a un Node descendiente de npm run server, sh y una terminal
Bash/Relay de WSL. El frontend Vite se ejecuta por separado con npm run dev.
No se observaron --watch, nodemon, PM2 o una unidad de servicio en esa cadena.
La ausencia de relanzadores externos de Windows/otros procesos NO está demostrada.
Las identidades de intervención deben capturarse de nuevo como PID + start time;
no se fijan aquí PID productivos ni rutas privadas.

Vite reenvía /api/lab a loopback 3001; no es la única vía de acceso. Auth y CSRF
limitan quién puede operar pero no constituyen mantenimiento global. El backend
no tiene control de pausa de admisión. Los flags in-progress y locks existentes
no cubren de manera común summary, activación, chat, acciones y propuestas.
No existe un handler de cierre que certifique fin de toda la actividad remota.

## Operaciones e identidades que deben verificarse

| Categoría | Información requerida | Limitación actual |
|---|---|---|
| Backend Node, npm y sh | PID, inicio, parent chain, listener y mecanismo de relanzamiento | No basta con detener un PID sin revisar sus padres/supervisor |
| Cliente Docker local | PID/inicio, dueño y vínculo al trabajo | Su exit/close no prueba fin dentro del contenedor |
| docker exec | Identidad de ejecución vinculada al contenedor y su generación | El contrato CLI actual no la conserva |
| Proceso OpenCode remoto | PID en namespace, inicio, parentesco, contenedor/inicio y baseline idle fiable | El nombre opencode o un PID aislado no bastan |
| Descendientes Compose/Bash | Árbol y estado real tras terminar el cliente | Un kill del padre no prueba terminación del árbol |
| Trabajo manual/otro cliente | Inventario completo y exclusión de nuevos lanzamientos | La aplicación no controla clientes Docker externos |
| Chat/warmup/continuación | Promesas, transportes y persistencia reales | No todo el trabajo aparece como proceso Docker |

Un inventario vacío incompleto, un timeout o la desconexión HTTP no satisfacen
la puerta. Todo proceso o tarea no clasificable mantiene NO-GO. No matar procesos
reales para obtener un inventario vacío. Los plazos 110/120/105 s no sustituyen
identidad o evidencia; propuestas y warmup tienen además sus propios presupuestos.

## Secuencia futura con puertas obligatorias

| Paso | Verificación necesaria | Parada |
|---|---|---|
| A. Anunciar | Operador responsable, alcance, clientes y ventana acordados | No equivale a bloqueo técnico |
| B. Cerrar admisión | Mecanismo verificado en todos los ingress, acceso directo y keep-alive, sin abrir privilegios | Hoy NO DISPONIBLE: no seguir en producción |
| C. Probar cierre | Solicitud protegida inocua rechazada sin iniciar trabajo; consultas seguras siguen disponibles | No usar generación para probar cierre |
| D. Inventariar | Trabajos existentes, hijos, continuaciones y categorías externas; PID + inicio/generación | Clasificación desconocida/incompleta = NO-GO |
| E. Esperar | Fin observado de operaciones conocidas dentro de plazo autorizado | Timeout no libera registros ni autoriza parada |
| F. Verificar remotos | Trabajo concreto o baseline idle completo bajo exclusividad demostrada | Cliente terminado no basta |
| G. Rechazar desconocidos | Reconciliación independiente y evidencia suficiente | No continuar ni matar huérfanos |
| H. Detener backend | Identidad exacta, mecanismo real de ejecución y relanzamiento retenido | No operar sobre OpenCode/Ollama |
| H2. Observar | Npm/sh/Node objetivo terminados, listener cerrado, sin generación nueva y gate conservado | Reaparición o trabajo nuevo = NO-GO |
| I. Cutover futuro | Backups, HOME, imágenes, recursos y rollback aprobados; autorización separada | No hay implementación de cutover aquí |
| J. Aceptar | CLI controlada primero; startup backend/warmup y HTTP después, solo operador autorizado, sin abrir admisión general | Aceptación HTTP necesita un canal restringido que hoy no existe |
| K. Reabrir | Aceptación completa o rollback verificado, identidad/recursos normales y autorización explícita | No abrir automáticamente al terminar un script |

El protocolo candidato aplica estas puertas mediante callbacks sin implementación
productiva. Su preflight exige evidencia de control de supervisor y admisión.
El adaptador debe declarar cobertura completa de inventario y no recibir esos
booleanos de una petición no confiable. Los tests los simulan deliberadamente;
no son evidencia de que esas capacidades existan en LAB-IA.

## Parada futura por el mecanismo real

Solo después de las puertas B–G, identificar la terminal propietaria y el job npm
correcto. Una futura señal/interrupción controlada debe dirigirse al job validado,
con autorización, y comprobar la salida de npm/sh/Node y cualquier descendiente.
No utilizar pkill por nombre, una sesión terminal ajena o un PID histórico.
No existe un comando systemctl/PM2 identificado que pueda recomendarse como si
estuviera instalado. Si aparece un supervisor, usar su mecanismo de stop/hold
verificado; no basta con matar su hijo.

Observar durante la ventana y antes de cada paso sensible; dos muestras no prueban
ausencia universal de relanzadores. Una reaparición obliga a detener la secuencia,
mantener el cierre y reconciliar la nueva identidad. No repetir señales a ciegas.
Detener Vite o cerrar pestañas no bloquea acceso directo al backend.

## Control mínimo pendiente

B estrictamente sin cambio ni control adicional no puede cerrar la admisión hoy.
La opción mínima a evaluar en una fase separada es un gate local de admisión y
arranque, sin el registro/orquestador complejo de A:

- Rechazo de nuevas operaciones protegidas en el router real, conservando auth,
  CSRF, lectura segura y contratos fuera de la ventana. Debe cubrir 3001 directo,
  proxy y conexiones ya abiertas, no solo una nueva fachada Vite.
- Control administrativo local privado, sin ruta pública, sin puerto TCP nuevo,
  sin inspector/SIGUSR1, sin sudo, y con confianza explícita en el UID del operador.
- Estado cerrado persistente que el launcher autorizado respete al reiniciar;
  warmup/continuaciones nuevas no deben iniciarse fuera de la política de ventana.
- Acceso de aceptación de una operación/operador autorizado; no un header arbitrario
  o un bypass global. La admisión normal permanece cerrada hasta la aceptación.

Esto requiere cambios futuros delimitados del backend/launcher y tests de carreras,
body lento, keep-alive, reinicio, warmup, rechazo sin efectos, aceptación y reversión.
No se implementó ni autorizó aquí. No resuelve la observabilidad remota: si no
puede demostrarse un inventario completo bajo exclusividad, sigue NO-GO.
Una frontera de ingress externa solo sería equivalente si no existe acceso directo
al backend; la topología actual no satisface esa condición. No improvisar firewall.

## Ensayo sintético y límites

Node HTTP simulado, IPC padre/hijo para gate, worker independiente y reinicio
supervisado simulado. Código y estado solo en directorios temporales exclusivos;
puerto 0/loopback, nunca 3001 ni 11434. Los procesos se lanzan exclusivamente con
el ejecutable Node y archivos de la fixture, entorno mínimo; no hay Docker, Ollama,
credenciales o HOME reales. El gate simulado vive en el hijo; no es la barrera A.

T01–T12 cubren cierre técnico, fin de trabajos, worker persistente, proceso
desconocido/inventario incompleto, timeout, desconexión, relanzamiento inesperado,
backend detenido, fallo de preflight, autorizaciones y conservación de estado.
Aceptación/rollback del ensayo son callbacks sobre datos sintéticos: no se prueban
cutover META A, inferencia, backups reales ni rollback productivo.

Resultado final de 5B.10P: 12 PASS, 0 FAIL, 0 SKIPPED y 0 canceladas; duración
4.355 s. Incluye rechazo de reapertura no autorizada y de identidad cambiada
durante aceptación. No se reutilizan como resultado actual los 76 tests de 5B.10O.

```bash
node --test --test-reporter=spec docker/candidates/5b10d/maintenance/window-b.test.mjs
```

## Recursos y rollback futuros

Gateway: 256 MiB y 0,5 CPU. Medir memoria disponible Windows/WSL antes y durante
la carga autorizada, pico de inferencia, swap/paginación, OOMKilled, reinicios y
latencia de servicios. No sumar reservas Windows/WSL ni extrapolar Ollama inactivo.
El umbral preliminar de 2 GiB no acredita capacidad para qwen3:8b.
El backend original inicia warmup al arrancar: autorizar y presupuestar ese efecto.

Rollback de ventana: mantener admisión cerrada; reconciliar todo trabajo antes de
restaurar. Usar principal + complemento y HOME anterior conservado, sin tocar
SQLite/sesiones para aparentar limpieza. Una parada/arranque del backend invalida
sus sesiones de RAM y puede perder respuestas/turnos en curso; no prometer su
recuperación. Reautenticación posterior por mecanismo existente, sin copiar tokens.
Rollback parcial fallido = conservar estado y evidencia; no seguir eliminando.
No prune, down -v, borrado de imágenes/volúmenes ni reinicio de Ollama.

Decisión final de diseño: ensayos útiles, pero NO-GO para ventana/cutover real.
El siguiente paso mínimo es decidir y autorizar el control técnico de admisión
y el método de inventario remoto antes de otra preparación productiva.
