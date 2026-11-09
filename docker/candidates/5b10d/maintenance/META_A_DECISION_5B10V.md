# META A — decisión de cierre de mantenimiento, 5B.10V

**OPCIÓN B — NO-GO. INVESTIGACIÓN CERRADA SIN PROMOCIÓN.**

Fecha: 2026-11-09. HEAD: `04e50657a20481440a32a5ea2e6490c80c6b1a84`.
Documento candidato; no instala protección, inicia mantenimiento ni autoriza
inferencia/cutover. Los 39 artefactos anteriores se conservan sin modificaciones.
No se crea un cuarto mecanismo, otro gate ni otro verificador remoto.

## 1. Decisiones definitivas de esta investigación

| Elemento | Decisión y alcance |
|---|---|
| GATE_INTEGRATION.patch, 5B.10T | **RECHAZADO**. Aplica sintácticamente, pero summary 200 conduce a DRAINING y el siguiente recibe 503 sin orden administrativa |
| Desacoplamiento temporal 5B.10U | **RECHAZADO POR CONTRAEJEMPLO**. Consigue 200→200 conservando incertidumbre, pero admite una activación incompatible con trabajo remoto simulado activo |
| Barrera completa | **NO AUTORIZADA EN PRODUCCIÓN**. Pruebas de componentes no equivalen a ensamblaje productivo seguro |
| Contrato remoto actual | **INSUFICIENTE PARA TERMINACIÓN COMPLETA VERIFICADA**. CLI/exit/close y listados parciales no acreditan toda la familia ni trabajos externos |
| Gateway META A y frontal isolated | **VALIDADOS EN ENSAYOS TEMPORALES, NO DESPLEGADOS**. Se conserva esa evidencia funcional y de red, con sus límites |
| Producción actual | Mantiene configuración anterior, OpenCode directo hacia Ollama; no tiene frontal experimental, Gateway META A ni barrera desplegados |

No se interpreta un mock positivo como capacidad disponible en producción.
El contraejemplo tampoco prueba que hoy haya huérfanos productivos: demuestra que
la política ensayada no los excluye de forma suficiente.

## 2. Resultados relevantes y última evidencia válida

Los siguientes son resultados registrados en los artefactos de sus fases, no
pruebas reejecutadas en 5B.10V. Aquí solo se realizó lectura y verificación de
consistencia de archivos/metadata.

| Fase/experimento | Último resultado pertinente | Qué queda válido |
|---|---|---|
| 5B.8L / 5B.9E | Reviewer real exit 0, parser PASS, 429 recuperados; frontal isolated ensayada en 9E | Viabilidad funcional temporal con Ollama; no adopción productiva |
| 5B.10G / 5B.10H.1 | Reviewer/mock/parser/SSE PASS; A→B→A temporal PASS | HOME mínimo operativo y activación con frontal preservada bajo arnés |
| 5B.10M–N-C | 33 unitarias de barrera; regresión de 64 casos en N-C | Primitivas y factories con mocks en su alcance documentado |
| 5B.10O | 76 casos PASS, ensamblaje VM y consumidor remoto | Wiring parcial de código real con dependencias simuladas; sin prueba remota productiva |
| 5B.10P | 12 casos sintéticos PASS | Puertas de ventana B ensayadas, sin adaptador productivo de admisión/inventario |
| 5B.10Q | 9 casos seleccionados PASS | Gate conceptualmente posible; top/ExecIDs insuficientes para quiescencia global |
| 5B.10R | 15 casos PASS | Contrato/prototipo conservador con procesos Node sintéticos; descendencia Docker no acreditada |
| 5B.10S | 16 casos PASS | Adaptador mínimo aislado; no prueba de promoción de su wiring completo |
| 5B.10T | 88 casos anteriores aprobados tras corregir rutas del arnés; 8 diagnósticos aprobados | Bootstrap cerrado y reproducción del defecto; aceptación funcional NORMAL **FAIL** |
| 5B.10U | 65 casos de regresión PASS; reproducción original PASS; variante: 1 diagnóstico PASS y 1 seguridad FAIL | Originales conservadores intactos; hipótesis mínima de desacoplamiento rechazada |

No sumar estos recuentos como casos independientes de una única auditoría.
`uncertainty-feasibility.test.mjs` contiene deliberadamente la aceptación de
seguridad incumplida: su fallo documentado no debe borrarse para presentar una
suite global verde. No ejecutar indiscriminadamente artefactos de investigación
como instaladores o validadores de promoción.

## 3. Inventario cerrado: 39 archivos previos

Clasificación primaria exhaustiva: **6 componentes reutilizables condicionados,
14 pruebas/experimentos, 12 documentos, 1 parche rechazado y 6 herramientas o
metadatos diagnósticos**. Reutilizable significa código que puede revisarse para
otra integración, no aprobado para instalarlo. Ningún artefacto se elimina.

### Componentes reutilizables condicionados — 6

| Archivo | Última versión/evidencia válida y límite |
|---|---|
| barrier.mjs | Primitivas originales conservadas hasta U; fail-closed y registro probados; política NORMAL/remoto no apta para el patch T |
| backend-hooks.mjs | Hooks originales hasta U; útiles para promesas, hijos y reservas; requieren integración exhaustiva y evidencia independiente |
| private-store.mjs | Persistencia/owner lock revisados; no es política de reconciliación remota |
| local-control.mjs | Unix privado, deny por defecto; mismo UID comparte dominio de confianza |
| admission-gate.mjs | Versión S conservada; adaptador aislado aprobado en su alcance, no wiring T |
| remote-termination.mjs | Consumidor O conservado; verifica observaciones confiables hipotéticas, no las obtiene de Docker |

### Pruebas y experimentos — 14

| Archivo | Última versión/evidencia válida y estado |
|---|---|
| barrier.test.mjs | Suite de 33; copia temporal con fixtures reubicadas para regresión U; original intacto |
| backend-integration.test.mjs | Factories reales con mocks y HTTP sintético; regresión total T y selección U |
| integration-fixture.mjs | Fixture N: fuentes copiadas, SQLite/seguridad sintéticas; no servidor productivo |
| assembly-remote.test.mjs | O: 6 consumidores remotos + 6 ensamblajes; repetidos en T |
| isolated-assembly.mjs | O: facades VM de fuentes revisadas; no sandbox de código hostil ni E2E productiva |
| window-b.mjs | P: protocolo de ventana mediante callbacks, sin control productivo de admisión/inventario |
| window-b-fixture.mjs | P: backend y supervisor sintéticos; no evidencia de capacidad real |
| window-b.test.mjs | P: 12 escenarios sintéticos registrados |
| remote-run.mjs | R: estados/identidad prototipo, sin transporte ni persistencia productivos |
| remote-run.test.mjs | R: 15 escenarios; repetidos en U con procesos Node propios y API simulada |
| admission-gate.test.mjs | S: 12 escenarios; repetidos en T/U, cuatro coberturas reutilizadas en S |
| patch-fixture.mjs | T: aplica solo a copia temporal; no altera fuentes activas |
| integration-patch.test.mjs | T: 8 diagnósticos; P08 sigue siendo reproducción negativa, repetida en U |
| uncertainty-feasibility.test.mjs | U: última hipótesis 200→200, rechazada por prueba de seguridad; no promovible |

### Documentación — 12

| Archivo | Estado de uso |
|---|---|
| README.md | Entrada histórica M; complementar con este cierre, no interpretar aisladamente como autorización |
| INTEGRATION_PLAN.md | Plan histórico M/N de barrera; no aplicado, no adoptado como requisito completo de META A |
| RUNBOOK_CORRECTIONS.md | Reconciliaciones históricas propuestas; incorporar decisiones posteriores antes de cualquier uso |
| RUNBOOK_CORRECTIONS.diff | Diff documental no aplicado; referencia a barrera integrada quedó superada; **no aplicar tal cual** |
| ASSEMBLY_FINDINGS.md | Evidencia O, alcance parcial y recomendación B entonces condicional |
| WINDOW_B_PLAN.md | Procedimiento candidato P, sin puertas productivas resueltas |
| WINDOW_B_RUNBOOK_CORRECTIONS.md | Correcciones P todavía no aplicadas a promotion/ |
| GATE_REMOTE_FEASIBILITY_5B10Q.md | Decisión Q, superada en alcance por estudios R–U; evidencia histórica válida |
| REMOTE_CONTRACT_5B10R.md | Insuficiencia del contrato actual y límites de las opciones estudiadas |
| GATE_INTEGRATION_5B10S.md | Aprobación limitada del adaptador S, **no** del parche de integración T |
| PATCH_REVIEW_5B10T.md | Rechazo definitivo del patch T y cobertura pendiente |
| UNCERTAINTY_REVIEW_5B10U.md | Rechazo de la variante mínima; no hay parche corregido aprobado |

### Parche rechazado — 1

`GATE_INTEGRATION.patch`: versión T de 13 archivos, +541/-33 líneas; preservada.
SHA-256: `ed4b6e93e4e6103819188b67c6ddb366ae4474fc0ff4d394ee8529f14e3222af`.
Su aplicación limpia y su hash NO equivalen a aceptación. U no lo sustituyó.

### Herramientas y metadatos diagnósticos — 6

| Archivo | Estado |
|---|---|
| INTEGRATION_SOURCES.json | Fija fuentes usadas en el staging N; no certifica la integración |
| ASSEMBLY_SOURCES.json | Fija grafo de 29 fuentes O; no acredita recursos externos |
| BASELINE_5B10NC.json | Baseline reconciliado histórico, conservar sin sobrescritura |
| GATE_PATCH_MANIFEST.json | Vincula hashes y base del patch T rechazado; consistencia comprobada |
| stage-backend.mjs | Transformador de fuentes para fixtures, no instalador productivo |
| build-integration-patch.mjs | Constructor del artefacto T rechazado; no ejecutar para promover o reemplazar evidencia |

## 4. Separación de requisitos

| Grupo | Requisitos y relación con el alcance |
|---|---|
| Intrínsecos a META A | OpenCode solo FRONT internal+isolated; Gateway FRONT+UPSTREAM con listener frontal exclusivo; provider restringido, modelo fijo, hardening/workspace RO/HOME saneado; Ollama y acceso loopback del backend conservados; reviewer y parser funcionales |
| Necesarios para este cutover controlado | Cierre técnico de admisión y de productores incompatibles; reconciliar lo ya iniciado; comprobar ausencia de trabajo incompatible durante la ventana; controlar relanzamiento; respaldos/HOME/imágenes vigentes; recursos; autorización, aceptación y rollback verificables |
| Mantenimiento avanzado opcional | Servicio continuo NORMAL/DRAINING/MAINTENANCE integrado, registro durable por job, API Unix permanente, diagnóstico remoto genérico, reapertura automatizada y trazabilidad histórica completa |
| Trabajo futuro potencial de FOLAB | Orquestación general de múltiples agentes/instancias, políticas de compatibilidad por operación, control multiusuario y recuperación genérica; no se fija aquí un roadmap ni se atribuyen requisitos FOLAB no documentados |

Para una única ventana no es intrínsecamente obligatorio identificar para siempre
cada job ni integrar la barrera completa. Sí es obligatorio demostrar en esa
ventana que no queda trabajo que pueda interferir y que no puede empezar otro.
Un inventario completo, confiable y estable bajo exclusividad podría satisfacer
ese objetivo sin trazabilidad permanente, pero tal evidencia **no está disponible
ni validada hoy**. No elevar lo opcional a bloqueador perpetuo ni degradar esta
necesidad a una espera arbitraria.

Egress estricto del Gateway, DNS universalmente cerrado, forwarding exhaustivo y
aislamiento de Internet de Ollama son riesgos pendientes de NIVEL 2, fuera de la
garantía META A. Deben aceptarse/documentarse explícitamente; no se presentan como
resueltos ni como requisitos técnicos implícitos para terminar esta investigación.

## 5. Matriz de bloqueadores

| Bloqueador | Evidencia disponible | Evidencia faltante | Riesgo | Condición GO | Condición NO-GO | Solución mínima posible, no implementada |
|---|---|---|---|---|---|---|
| Admisión | Factories y socket candidatos funcionan con mocks; T/U rechazados | Cierre efectivo de todos los entrypoints, incluido 3001 directo, sin romper NORMAL | Nuevo trabajo durante recreación | Mecanismo concreto aprobado, rechazo probado sin efectos y mantenido en toda la ventana | Solo aviso verbal/Vite cerrado, gate rechazado o vía directa abierta | Validar un cierre técnico acotado de las entradas reales; no asumir que ya existe ni instalar T |
| Operaciones ya iniciadas | Código de summary/chat/acciones/propuestas/continuaciones auditado; flags parciales | Conjunto completo de tareas y finalización real antes de tocar recursos | Pérdida de respuestas, escrituras o generación pendiente | Admitidos conciliados y efectos concluidos con evidencia | Desconexión, Promise.race o timeout usado como prueba de fin | Conciliación operativa de las tareas conocidas bajo cierre; desconocidos bloquean |
| Hijos locales | PID/parent chain y seguimiento close ensayados | Identidad actual, nacimiento y fin de todos los hijos relevantes | Clientes/scripts sobreviven al padre | Procesos vinculados concluidos y sin descendientes locales desconocidos relevantes | Solo nombre, exit del padre o señal enviada | Inventario por identidad y cierre verificable; no kill indiscriminado |
| Descendientes remotos | Top puntual/ExecIDs; CLI no liga familia; contraejemplo U | Inventario suficiente o prueba independiente de ausencia de trabajo incompatible | Recrear OpenCode sobre ejecución superviviente | Evidencia completa, ligada a contenedor/generación y alcance, bajo exclusividad | Lista parcial/vacía, exit 0, nombre, timeout o verificador mock | Aportar prueba operacional suficiente para la ventana; si el entorno no puede, mantener bloqueo |
| Invocaciones externas | Backend solo controla sus entradas; Docker/CLI manuales quedan fuera | Todos los productores relevantes identificados y técnicamente retenidos | Carrera después de la comprobación | Control del operador y evidencia de exclusión de nuevos lanzamientos | Acuerdo sin control, productor no identificado o mismo UID no considerado | Delimitar y controlar acceso operativo existente; no añadir privilegios ni firewall global |
| Supervisión/relanzamiento | Cadena npm/sh/Node observada; sin supervisor identificado en esa cadena | Control verificable de relanzadores externos y nueva generación | Backend/warmup reaparecen durante intervención | Mecanismo real de ejecución bajo control y no relanzamiento durante ventana | Matar un PID y asumir estabilidad | Usar el mecanismo real del operador/supervisor verificado, si existe; detener solo tras conciliación |
| Memoria con inferencia | Gateway mock aproximadamente 64–67 MiB; presupuesto 256 MiB/0,5 CPU; inferencia previa funcional | Pico confiable de qwen3:8b con la carga prevista, swap/impacto | OOM, reinicios, latencia o incumplir 110/120/105 s | Medición autorizada con margen y umbrales explícitos, sin degradación/OOM/reinicios | Inferir capacidad de Ollama inactivo o sumar reservas Windows/WSL | Una medición acotada autorizada después de habilitar precondiciones seguras; no se ejecuta aquí |
| Respaldos | Principal y complemento de historial verificados en fases previas, hashes conservados | Revalidación de vigencia frente al instante del futuro cambio | Restaurar configuración o historial desactualizados | Lectura/hash/permisos/rutas coinciden y diferencias legítimas reconciliadas | Sobrescribir histórico, backup ilegible o desajuste | Revalidar ambos por separado; complemento nuevo solo si hay cambios autorizados |
| HOME | Nuevo HOME auditado 27 paquetes; Bun operativo en mock; anterior conservado | Revalidar permisos, dependencias y mounts finales al promover | Importar secretos o romper runtime | HOME existente pasa auditoría, sin recrearlo/copiar sesiones; anterior accesible | Reutilización no revisada, enlaces privados, dependencias faltantes | Verificar HOME preparado y referencias; 7 SRI vs 20 hashes/versiones locales, sin afirmar autenticidad total |
| Rollback | Paquete y procedimiento candidato; A→B→A temporal probado | Runbooks reconciliados, rutas vigentes y capacidad operativa durante fallo | Reversión parcial o reapertura insegura | Secuencia precisa autorizada, respaldo válido, puntos de parada y aceptación definidos | Confundir ensayo temporal con rollback productivo probado o limpiar ante discrepancia | Corregir documentación en fase autorizada; preservar HOME/modelos/volúmenes y detener ante fallo parcial |

Respaldos y HOME no son fallos demostrados: están preparados y exigen un control
de vigencia. La memoria es condicional, no una OOM demostrada. La ausencia de
evidencia de exclusividad es un bloqueador, no una afirmación de ataque o bypass.

## 6. Única intervención contemplada, sin ejecución

Se conserva solo la ventana operativa ya estudiada, no una cuarta alternativa:

1. Autorización, alcance y responsable; acuerdo de exclusividad acompañado de
   cierre técnico verificable de nuevas entradas y productores relevantes.
2. Identificar/conciliar tareas admitidas, diferidas, procesos locales y remotos;
   esperar finalización con evidencia y plazo diagnóstico. Incertidumbre: parar.
3. Verificar que no hay trabajo incompatible y que el control se mantiene;
   entonces, y solo entonces, parada controlada del backend y retención de su
   relanzamiento. La parada no demuestra el punto 2 ni termina remotos por sí sola.
4. Con respaldos/HOME/imágenes/recursos vigentes y autorización separada, preparar
   Gateway, verificar su escucha y acceso permitido; preservar Ollama y otras apps.
5. Cutover reversible solo de OpenCode, aceptación funcional/de red con workspace
   sintético, y revalidación antes de cualquier activación A→B→A o rollback.
6. Arranque del backend, warmup y aceptación HTTP solo bajo autorización y acceso
   operativo exclusivo comprobado; reapertura general separada después del PASS.

**Hoy se detiene en el punto 1; los puntos 2–3 tampoco están acreditados.** No
hay instrucciones nuevas para señales, firewall, parada, docker exec o recreación.
No matar huérfanos ni reiniciar contenedores para sustituir evidencia ausente.

## 7. Paquete promotion/: consistente, todavía no ejecutable

El verificador de lectura pasó: **16 archivos del paquete y 16 fuentes fijadas**.
Se leyeron configuración final, provider y runbooks; no se ejecutó ningún paso de
instalación, aceptación, preparación HOME, backup o rollback. promotion/ conserva
sus hashes. Las siguientes correcciones requieren otra autorización documental,
no aplicar los diffs históricos automáticamente:

| Archivo | Actualización indispensable antes de habilitar su uso |
|---|---|
| README.md | Enlazar este NO-GO; separar viabilidad de arquitectura de permiso operativo; retirar cualquier interpretación de gate/barrera desplegados |
| BACKUP_PLAN.md | Consumir principal existente y complemento del historial por separado; verificar vigencia, no sobrescribir históricos ni copiar HOME |
| CUTOVER.md | Sustituir prepare_home por auditoría del HOME ya preparado; insertar cierre técnico/conciliación/relanzamiento verificados antes de cambios; top por nombre no basta; T/U no son solución válida |
| ACCEPTANCE.md | Usar historial del complemento, acceso de operador realmente exclusivo y autorización de startup/warmup; aclarar texto inicial de una inferencia frente al presupuesto posterior de dos; número exacto solo con autorización futura; mantener límites 110/120/105 s |
| ROLLBACK_PRODUCTION.md | Tomar historial/referencias del complemento y configuraciones del principal; incluir control del backend/reapertura y conciliación previa a restaurar; preservar ambos HOME y modelos |
| Manifiestos y referencias | Regenerar solo después de revisar cambios autorizados; no borrar checks para aceptar fuentes nuevas |

El cierre actual no elige un mecanismo de admisión inexistente para rellenar esas
puertas. Los runbooks permanecen bloqueados. Metadata de una intervención futura
debe ir a evidencia privada nueva/complementaria, no alterar el respaldo histórico.
No se declara rollback productivo ensayado: solo recuperabilidad revisada y ensayo
temporal A→B→A, con su alcance.

## 8. Alcance definitivo y condición cerrada de reconsideración

**Se elige OPCIÓN B. META A sigue bloqueada con la implementación actual.**

Falta la capacidad operacional conjunta de (a) impedir nuevos trabajos y (b)
acreditar ausencia de trabajo incompatible durante la intervención. Los gates
ensayados no aportan una integración productiva aprobada y el contrato remoto
no aporta por sí solo esa evidencia. Parar backend, observar dos procesos o
conseguir dos HTTP 200 no cubre esa falta.

Esto no invalida el Gateway ni exige resolver todo mantenimiento avanzado.
Para reconsiderar B se requiere un expediente concreto, sin nuevo permiso
implícito: identificación de todos los productores y su cierre técnico; lista
completa de tareas/hijos relevantes y evidencia de finalización o compatibilidad;
alcance/identidad/generación de la observación remota y sus limitaciones; control
del relanzamiento; pruebas reproducibles de que el control se mantiene y no rompe
NORMAL. Un campo crítico desconocido mantiene NO-GO. Además deben satisfacerse
recursos, backup, HOME, rollback y autorización antes de cutover.

No se prescribe identidad permanente por cada job como única forma de lograrlo,
ni un nuevo servicio para producir ese expediente. Tampoco se asume que hoy haya
un procedimiento capaz de cumplirlo. Si no puede aportarse esa evidencia en el
entorno actual, la decisión permanece cerrada y producción sigue como está.

**Siguiente paso único:** revisión formal por el operador de este documento para
aceptar el bloqueo de promoción META A y cerrar la línea de prototipos M–U.
No abrir otra fase técnica salvo que se aporte el expediente anterior para una
decisión explícita de reapertura. Esta es una puerta de evidencia definida, no
una nueva investigación abierta ni una autorización de mantenimiento.

## 9. Validación y conservación

Solo se crea este Markdown. No se ejecutan tests, prototipos o runbooks en V;
los resultados funcionales anteriores se identifican como reportados. Las
verificaciones actuales son de lectura: Git, hashes, manifiestos, snapshots de
contenedores/redes/mounts, listener y referencias/metadata privadas autorizadas.

El estado productivo se compara con el baseline inicial de la fase, conservando
el baseline histórico reconciliado. No se modifican Docker, backend, OpenCode,
Ollama, HOME ni respaldos. El HOME anterior se verifica solo por referencia de
mount y metadata de raíz, sin leer contenido privado de sesiones.

Resultado final: contenedores, redes, puertos, mounts y archivos de configuración
del snapshot coinciden exactamente con el baseline inicial de V. El HOME preparado
y ambos respaldos conservan sus hashes canónicos conocidos. Los 39 candidatos
previos conservan sus hashes; solo se añade este documento. Git sigue en 04e5065,
main sincronizada, sin staging ni modificaciones versionadas; quedan 40 candidatos
sin rastrear. Verificador del paquete y whitespace PASS.

**Incidencia de identidad del backend:** el listener continúa en 127.0.0.1:3001,
pero el proceso histórico ya no está presente. La instancia observada tiene una
identidad distinta y una marca de inicio verificada localmente, bajo sh/npm run
server y terminal Bash/Relay.
La causa del cambio frente a fases anteriores es INDETERMINADA. No se registró
una identidad fresca de backend junto al snapshot Docker inicial de V, por lo
que no se afirma que el cambio ocurriera durante esta fase ni se acredita
continuidad de su identidad respecto al histórico. No se reinició ni detuvo el
servicio desde esta investigación. Su disponibilidad actual no sustituye esa
comparación: producción Docker intacta; continuidad histórica del proceso backend
NO VERIFICADA. Registrar esta discrepancia al considerar cualquier reapertura.

META A: **NO-GO**. NIVEL 2: **NO declarado**. No despliegue, inferencia, instalación,
commit o push. Las aprobaciones anteriores limitadas a mocks no cambian esta decisión.
