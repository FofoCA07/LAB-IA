# 5B.10U — desacoplamiento mínimo evaluado y rechazado

AUDITORÍA Y ENSAYO AISLADO. Base `04e5065`. **NO-GO** para corregir/promover el
candidato con el cambio mínimo ensayado. GATE_INTEGRATION.patch sigue RECHAZADO,
sin sobrescritura. No se modifican barrier.mjs, hooks, contrato remoto ni activos.

## Causa exacta, explicada antes de editar la copia

1. El patch T envuelve queryOpenCode/summary/lab-open con
   maintenance.child(..., {remote:true}), sin un verificador remoto suficiente.
2. backend-hooks.mjs/child registra el proceso y llama a job.trackChild.
3. barrier.mjs:121–124 recibe close, libera el recurso local e inicia
   verifyRemoteCompletion. No equivale al cierre de una respuesta HTTP.
4. En barrier.mjs:113–118 el verificador por defecto devuelve false, o falla:
   se ejecuta mark('UNCERTAIN'); no se libera la reserva remota.
5. barrier.mjs:86 asigna conjuntamente j.uncertain=true y state='DRAINING'
   para cualquier código salvo OPERATION_FAILED. No exige petición administrativa.
6. En la siguiente solicitud, ticket/admit rechaza porque state no es NORMAL
   (barrier.mjs:68–69). backend-hooks.mjs:21–24 traduce ADMISSION_CLOSED a
   HTTP 503/code MAINTENANCE. El guard de auth no es la causa del rechazo.

También cancelaciones de fetch y otros caminos marcan UNCERTAIN: cambiar ese
código globalmente afecta más que el caso exitoso de summary. Timeout/PROCESS_ERROR,
fallo de persistencia, recuperación y pérdida de control tienen otros motivos
legítimos de cierre que no deben eliminarse.

Se reprodujo primero el parche original mediante P08: primer summary 200,
estado DRAINING con reserva incierta y segundo summary 503, sin orden de drain.
Resultado: 1 diagnóstico PASS; NO constituye aceptación funcional.

## Variante mínima: SOLO TEMPORAL, NO ES UN PATCH DE PROMOCIÓN

En una copia /tmp del barrier incluido en el parche se ensayó esta sustitución:

```js
// Original
if (code !== 'OPERATION_FAILED') { j.uncertain = true; state = 'DRAINING'; }
// Hipótesis temporal rechazada
if (code !== 'OPERATION_FAILED') {
  j.uncertain = true;
  if (code !== 'UNCERTAIN') state = 'DRAINING';
}
```

No se cambió ninguna otra condición de admisión, reserva, persistencia, confirm,
verificación o autorización. Un único sitio lógico, una línea sustituida por una
línea más larga en el archivo temporal. El arnés valida primero el patch original,
aplica la sustitución después y antes de importar el runtime de la copia. La
variante se identifica como contrafactual: no se presenta como el artefacto
validado por el manifiesto T ni se guarda como parche nuevo instalable.

Resultado real del servidor copiado/VM: **200 → 200**, con NORMAL y los registros
inciertos anteriores conservados. Después de drain explícito, la solicitud nueva
recibe 503 y confirm devuelve NOT_DRAINED. No se convirtió UNCERTAIN en VERIFIED.
Esto separa mecánicamente admisión de certificación, pero NO acredita seguridad
de admitir el trabajo siguiente.

## Contraejemplo de seguridad

La segunda prueba conserva un trabajo remoto simulado activo después de cerrar
su cliente local. El verificador devuelve false mientras ese trabajo siga activo.
Tras marcar incertidumbre, la variante queda NORMAL y admit('activation') tiene
éxito. El gate no dispone de información para clasificar ese conflicto antes de
admitir. Activar puede recrear el contenedor/workspace de una ejecución anterior.

La aserción obligatoria de rechazo **FALLÓ** con Missing expected exception.
No se invirtió ni se omitió la comprobación para obtener PASS. Es un contraejemplo
con mocks a la política propuesta, no una activación real ni prueba de huérfanos
en producción. Ninguna operación Docker se ejecutó desde las pruebas.

Por tanto no se aprueba U02 a partir del simple 200 de la segunda solicitud.
Los guards/locks del backend actual no certifican la vida de descendientes remotos:
que finalice el handler no certifica ausencia de conflicto en el contenedor.
La prueba de admisión usa el mismo primitivo al que delega dispatch; no afirma
que se haya recreado un contenedor ni ejecutado un handler de activación real.

## Evaluación de los invariantes y U01–U12

| Requisito | Evidencia / límite |
|---|---|
| U01 | Summary 1 devuelve 200 en el servidor copiado |
| U02 | Summary 2 devuelve 200 en la variante, pero NO APROBADO como admisión segura: el contraejemplo admite conflicto |
| U03 | Jobs/reservas inciertas de summary 1 siguen presentes después de summary 2 |
| U04 | drain explícito cierra admisión y HTTP pasa a 503 en la variante |
| U05 | confirm NOT_DRAINED con registros inciertos, en la variante |
| U06 | Regresión del prototipo remoto: timeout conserva UNCERTAIN, no FINISHED_VERIFIED; no es evidencia del servidor productivo |
| U07 | R05/R06 con descendiente Node sintético bloquean verificación; la variante también bloquea confirm, pero NO bloquea admisión conflictiva |
| U08 | Regresión del control Unix/adaptador: autorización denegada por defecto y reapertura rechazada sin autorización |
| U09 | Regresión de barrera/factories sin cambios: reinicio cerrado y jobs pendientes; no se declara aceptación completa de reinicio de la variante rechazada |
| U10 | Regresión G09 y factories protegidas: auth/validaciones preservadas; no se modificaron en la variante |
| U11 | I11 y T09 conservan reserva de continuación; factories reales copiadas con mocks |
| U12 | VM con FS/HTTP/SQLite ficticios y procesos simulados; tests remotos solo Node sintético; cero llamadas Docker/Ollama en el arnés |

I2–I6 no justifican debilitar I7. Las reservas activas/incertidumbres no pueden
ignorarse solo porque el estado administrativo sea NORMAL. I8 e I9 se conservan
en los módulos originales; no se añade permiso, tool o ruta administrativa.
No se alteró el contrato remoto (I10).

## Decisión de factibilidad

**Desacoplamiento mecánico: SÍ. Desacoplamiento seguro aprobado con la evidencia
actual: NO.** Una política de admisión necesita distinguir incertidumbre residual
sin conflicto de trabajo activo o de conflicto no descartable. El contrato actual
no proporciona esa distinción para los remotos. No hay un callback productivo
independiente que certifique compatibilidad de la operación siguiente.

Mantener NORMAL pero rechazar operaciones ante conflicto desconocido sería
conservador, aunque no resuelve el comportamiento habitual pedido. Permitirlas
por defecto, excluir activation únicamente, esperar unos segundos, confiar en
exitCode=0 o aceptar un booleano del request no demostraría seguridad para el
resto. Tampoco sería correcto borrar registros al admitir trabajo nuevo.

Hay además acumulación: sin prueba remota los registros no se liberan y el límite
de 256 trabajos acaba rechazando admisiones. No se cambia capacidad ni se agregan
expiraciones para esconderlo. Esta es otra razón para no presentar el cambio de
una línea como solución productiva completa.

No se inicia otra arquitectura ni se amplía a un clasificador de conflictos,
verificador remoto o nueva barrera. Conforme al criterio de parada, se conserva
NO-GO y los 37 candidatos previos intactos. No se genera nuevo parche corregido.

## Resultados actuales, sin reutilizar recuentos históricos

| Ejecución | PASS | FAIL | SKIPPED | Duración |
|---|---:|---:|---:|---:|
| P08 original, reproducción | 1 | 0 | 0 | 459,946473 ms |
| Ensayo temporal de desacoplamiento | 1 | 1 | 0 | 558,699045 ms |
| Unitarias barrera 33 + adaptador 12 + prototipo remoto 15 | 60 | 0 | 0 | 1048,969828 ms |
| Factories I07, I11, I14, I16, I21 | 5 | 0 | 0 | 384,271921 ms |

Regresión de candidatos conservados: **65 PASS, 0 FAIL, 0 SKIPPED**.
Aceptación de la corrección: **FAIL**. El PASS diagnóstico del 200/200 no compensa
el fallo de seguridad. No se ejecuta el resto de una aceptación completa de una
corrección que ya vulnera el criterio de admisión segura.

El primer intento de los dos tests nuevos falló antes de ensayar comportamiento
porque el anclaje de texto del arnés coincidía dos veces. Solo se precisó ese
anclaje en el archivo nuevo y se repitió: la ejecución válida produjo el contraejemplo
anterior. No se modificó ningún test existente ni el patch rechazado.

## Artefactos, reproducción y recuperación

Archivos nuevos de esta fase: uncertainty-feasibility.test.mjs y este documento.
El primero es un ensayo negativo que deja deliberadamente fallar una obligación
de seguridad no satisfecha; no es una suite de promoción aprobada.

```bash
node --experimental-vm-modules --test --test-reporter=spec \
  docker/candidates/5b10d/maintenance/uncertainty-feasibility.test.mjs
```

Resultado esperado de esa hipótesis rechazada: código 1 y Missing expected
exception en U-SAFETY. No ejecutar build-integration-patch para sustituir el
parche histórico ni alterar su manifiesto. Copias ejecutables, sockets, bases
ficticias y variantes permanecen en /tmp y se eliminan mediante los hooks propios.
La prueba de barrera existente se copió a /tmp cambiando solo rutas de imports,
lectura de fuentes y destino de fixtures; checks intactos.

No hay rollback productivo que ejecutar. Los módulos originales y sus garantías
conservadoras permanecen. Mantener registros, HOME, backups y los parches
rechazados como evidencia; nunca limpiar incertidumbre para reabrir.

Siguiente paso mínimo: resolver con el operador qué evidencia independiente de
compatibilidad/exclusividad permitiría admitir el siguiente trabajo; si no existe
en este entorno, no integrar este candidato. No autorizar un nuevo parche basándose
solo en dos HTTP 200. Exclusividad operativa y memoria bajo inferencia siguen
bloqueando cutover; no se midió carga ni se contactó Ollama en esta fase.
