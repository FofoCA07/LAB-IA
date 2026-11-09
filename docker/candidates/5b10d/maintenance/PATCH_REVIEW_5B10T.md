# 5B.10T — parche candidato del gate: NO APLICAR

PREPARADO Y ENSAYADO SOLO EN COPIAS TEMPORALES. Base:
`04e50657a20481440a32a5ea2e6490c80c6b1a84`. Producción y los 31 candidatos previos
no fueron editados. No hay autorización para instalar este parche.

## Decisión

**NO-GO para integrar el parche.** El gate aislado de 5B.10S funciona, pero al
integrarlo con el seguimiento remoto conservador cambia el comportamiento normal:
un summary responde 200 y deja incertidumbre remota que pasa la barrera a DRAINING;
el summary siguiente responde 503. Esto es una regresión funcional reproducida
con el código aplicado, no un fallo supuesto del arnés. No eliminar incertidumbre,
inventar un verifyRemote positivo ni cambiar el contrato remoto para conseguir PASS.

El acoplamiento entre admisión y verificación de recursos de la barrera completa
es un bloqueador de complejidad para el gate mínimo. No ampliar automáticamente
la solución. Cutover continúa NO-GO además por exclusividad remota y memoria bajo
inferencia. No se declara NIVEL 2 ni integración E2E productiva.

## Artefactos y aplicación verificada

- GATE_INTEGRATION.patch: único parche, no aplicado al repositorio activo.
- GATE_PATCH_MANIFEST.json: base y SHA-256 del parche, fuentes y resultados.
- build-integration-patch.mjs: constructor de artefactos; lee HEAD y reutiliza
  transforms existentes. Solo escribe artefactos nuevos y temporales; no instala.
- patch-fixture.mjs: copia fuentes revisadas, comprueba/aplica solo bajo /tmp,
  verifica hashes y prepara facades VM. No importa index.js productivo.
- integration-patch.test.mjs: pruebas de integridad, bootstrap y diagnóstico.
- Este informe: decisión, cobertura, riesgos y rollback propuesto.

`git apply --check --whitespace=error` pasa sobre el working tree sin modificarlo.
El parche también se comprobó y aplicó a copias aisladas de las fuentes de HEAD.
Todos los archivos resultantes coinciden con los hashes del manifiesto y pasan
`node --check`. SHA-256 demuestra consistencia local, no autenticidad externa.
El constructor usa flag wx: no sobrescribe artefactos existentes al ejecutarse.
No ejecutarlo como procedimiento de promoción.

Al preparar el bootstrap se corrigió solo el código nuevo generado para que dos
llamadas de cierre compartan la misma promesa. Ningún módulo candidato anterior
se modificó. El generador fue reejecutado tras retirar exclusivamente sus dos
artefactos propios, antes de la validación final.

## Archivos y justificación

| Archivo previsto en server/ | Función y cambio propuesto | Riesgo / evidencia |
|---|---|---|
| index.js | Wiring de control privado antes de SQLite/listener; dependencias de warmup/chat; seguimiento de CLI y lab-open; no auto-warmup al recuperar | Principal riesgo de arranque y regresión NORMAL; P07/P08 |
| workspace-routes.js | dispatch summary/activate antes de efectos; status sin CLI durante cierre | Auth/body conservados; G/I existentes y aplicación sintáctica |
| chat-routes.js | dispatch antes de escrituras/generación | Rutas y guard intactos; I21/I22 existentes |
| actions.js | dispatch antes de decisión y continuación | Reserva previa a efectos; I11/I21 existentes |
| proposal-security.js | dispatch después del guard/validación | Frontera protegida; I21/I23 solo preflight seguro |
| chat-read-continuation.js | Usar defer antes de schedule | No perder reserva tras HTTP; I11 existente |
| ollama-warmup.js | Reservar antes del fetch y conservar shared promise | Arranque cerrado P07; I15/I24/I27 existentes |

No se pudo reducir esos siete puntos sin perder la cobertura prevista. No se
modifican rutas, permisos, modelo, configuración Docker, scripts, datos de
workspace, provider o destinos Ollama. Se añaden seis módulos en server/maintenance/:
cinco copias exactas de admission-gate, backend-hooks, barrier, private-store y
local-control, más runtime.mjs de bootstrap. No se instala transporte remoto,
daemon ni dependencia externa. El volumen del parche incluye código reutilizado,
no solo el adaptador de 24 líneas.

Conteo del artefacto final: **13 archivos, 541 líneas añadidas y 33 eliminadas**.
De las añadidas, 461 son los cinco módulos copiados y 24 el bootstrap; en los
siete archivos existentes hay 56 añadidas y 33 eliminadas. No se oculta ese coste
como si fuera únicamente un if de admisión. El comportamiento se ha vuelto más
amplio de lo aceptable para promover el gate mínimo con el contrato remoto actual.

## Bootstrap y autorización

runtime.mjs requiere un directorio privado ya existente: no crea ni sobrescribe
estado. index propone runtimePaths.runtimeDir/maintenance-control. No se crea
ese directorio productivo en esta fase. Los modos requeridos son 0700 para el
directorio y 0600 para estado/lock/socket; límite de longitud Unix conservado.

Cada arranque queda DRAINING con recoveryRequired, sin recuperación ni apertura
automáticas. Un arranque habilitado para operador mediante
LAB_MAINTENANCE_OPERATOR=1 permite los comandos locales acotados; sin esa opción,
la autorización permanece denegada. Es un opt-in de configuración del proceso,
no un secreto, ni autorización por header ni por URL. El dominio de confianza es
el UID del operador: no hay aislamiento frente a otro proceso de ese mismo UID.
No hay endpoint TCP administrativo ni diagnósticos de generación habilitados.

recover solo permite reconciliar un registro propio vacío. No borra jobs
recuperados; pendientes o corruptos bloquean la apertura. Esto NO prueba ausencia
global de trabajos. Con registros inciertos, la recuperación segura del servicio
no está resuelta por el parche: no borrar state.json ni owner.lock para saltarla.
El diagnóstico de fallo de inicio es fijo MAINTENANCE_STARTUP_FAILED y preserva
la evidencia privada. La genericidad del error limita el diagnóstico operativo;
un procedimiento local autorizado necesitaría inspeccionar metadata, nunca prompts.

## Pruebas realizadas

Regresión existente, antes de ensayar el parche:

| Categoría | Resultado válido de esta fase |
|---|---|
| Barrera, unitarias/socket/persistencia | 33 PASS |
| Adaptador G01–G12, factories y HTTP aislado | 12 PASS |
| Integración I01–I28, factories con mocks | 28 PASS |
| E01–E03, HTTP sintético/recuperación/desconexión | 3 PASS |
| Ensamblaje anterior A01–A06, VM con mocks | 6 PASS |
| Consumidor remoto R01–R06, evidencia simulada | 6 PASS |
| Total de casos existentes distintos | 88 PASS, 0 FAIL pendientes, 0 SKIPPED |

La primera ejecución de 88 produjo 87 PASS y 1 FAIL del arnés: al mover la prueba
de barrera a /tmp, T16 buscaba sus fuentes allí. Una primera corrección temporal
también alteró incorrectamente el allowlist de imports y dio 32/33. Se corrigieron
solo rutas de import/lectura y ubicación de fixtures en esa copia de /tmp; luego
33/33 unitarias pasaron. No se cambiaron checks ni módulos originales para aprobar.
Los otros 55 casos originales pasaron en la primera ejecución; no se repitieron.

Después, la ejecución de 33 unitarias corregidas + 8 pruebas propias dio
**41 PASS, 0 FAIL, 0 SKIPPED**, duración **2326,864203 ms**. En total se verificaron
96 casos distintos: 88 existentes y 8 nuevos. No sumar intentos/repeticiones como
pruebas distintas. El primer agregado de regresión duró 1103,686503 ms.

| Caso propio | Qué se verificó |
|---|---|
| P01 | Aplicación, hashes y sintaxis de los trece archivos |
| P02 | Arranque limpio cerrado; autorización por defecto denegada y comandos desconocidos rechazados |
| P03 | DRAINING/MAINTENANCE vacíos recuperables explícitamente; nuevo arranque vuelve cerrado |
| P04 | Registro pendiente no puede borrarse vía recover; JSON corrupto preservado y fallo controlado |
| P05 | Socket ocupado y directorio inseguro bloquean inicio, sin eliminar evidencia previa |
| P06 | Pérdida del control cierra admisión; store inseguro no permite reapertura |
| P07 | index aplicado y router/auth reales en VM: HTTP seguro, warmup cero, protegida 503, no autorizada 401 |
| P08 | Diagnóstico negativo de aceptación: summary/parser 200, después DRAINING y 503; confirm NOT_DRAINED |

**P08 PASS significa que el defecto se reprodujo; la aceptación funcional NORMAL
es FAIL.** No confundir pruebas verdes que detectan una regresión con aprobación
del parche. Arranque fail-closed probado, recuperabilidad completa tras trabajos
remotos inciertos NO demostrada.

El arnés del parche ejecuta el index COPIADO y aplicado en VM; se añaden exports
solo a la copia para observar estado. No se inyectan transforms de mantenimiento
adicionales sobre ese código: el wiring se toma del parche. Reutiliza las facades
auditadas de isolated-assembly: FS acotado, SQLite ficticio, procesos EventEmitter,
fetch simulado, consola con contador y listener real redirigido de 3001 a un
puerto efímero de loopback. Nunca se escucha en 3001 ni se conecta a Ollama.
El runtime parcheado se importa desde la copia; se valida su directorio propuesto
y se redirige al control temporal. Las fuentes/transportes peligrosos no se exponen.

## Cobertura pendiente y complejidad

No se completó una aceptación exhaustiva del parche después de P08: el criterio
NORMAL ya falló. Las pruebas existentes acreditan hooks de body lento, dos
operaciones, hijos, timeout, diferidos y desconexión con mocks; NO se atribuyen
silenciosamente todas esas coberturas al nuevo wiring del index aplicado.
No hubo inferencia, Docker exec, lab-open, datos reales o servidor productivo.

Además, propuesta/aplicación mantienen llamadas internas a Git y transportes
que el wiring mínimo de los siete archivos no cubre exhaustivamente ante sus
Promise.race/deadlines. No basta que su preflight simulado pase. Resolverlo podría
exigir más inyección y cambios de archivos; no se amplía automáticamente el patch.
No se ejecutaron generaciones/aplicaciones de propuesta reales ni se certificó
que esas familias hayan terminado. Esto es un bloqueador adicional de aceptación.

El socket ocupado/inseguro se prueba a nivel del bootstrap real, no cada variante
de fallo dentro del servidor completo. La política administrativa es candidata y
necesita revisión operativa antes de instalarse. No se ocultan estas limitaciones
por disponer de hashes, sintaxis válida y pruebas de componentes anteriores.

## Rollback futuro, no ejecutado

A. Código: mientras el parche no esté aplicado, no hay rollback productivo que
ejecutar. Si se autorizara una instalación futura, respaldar los siete archivos
originales y hashes antes; conservar los módulos nuevos hasta cerrar los usuarios
que los estén usando. La restauración debe realizarse dentro de ventana exclusiva.

B. Estado: conservar directorio privado, jobs y fault; no sustituir por un JSON
vacío ni eliminar locks automáticamente. Un lock huérfano requiere diagnóstico
de identidad/propiedad y autorización separada. Mantener ambos HOME y backups.

C. Pendientes: no retirar hooks ni restaurar un backend que admita tareas mientras
los trabajos admitidos sigan inciertos. Si no hay prueba suficiente, NO-GO; no
matar procesos desconocidos ni recrear contenedores para aparentar drenaje.

D. Reapertura: requiere aceptación o rollback verificado y autorización local.
Restaurar código anterior elimina el gate: no continuar cutover bajo esa versión.
Si falla parcialmente la restauración, preservar evidencia, mantener exclusividad
y detener la secuencia. No down -v, prune, borrado de SQLite, HOME o volúmenes.

## Siguiente paso delimitado

Revisar este rechazo antes de autorizar una implementación: decidir si puede
desacoplarse la política de admisión del seguimiento remoto conservador sin
declarar drenaje ni perder incertidumbres. No aplicar el patch rechazado ni
introducir otro sistema de mantenimiento. Si no hay una reducción clara y
verificable del alcance, conservar NO-GO y no integrar.
