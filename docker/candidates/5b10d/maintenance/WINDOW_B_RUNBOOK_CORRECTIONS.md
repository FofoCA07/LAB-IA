# Correcciones candidatas para B — NO APLICADAS

Complementa RUNBOOK_CORRECTIONS.md y WINDOW_B_PLAN.md. promotion/ conserva sus
archivos y hashes. Este documento no es un script ejecutable de mantenimiento.

| Documento actual | Corrección requerida antes de usarlo |
|---|---|
| BACKUP_PLAN.md | Consumir principal verificado y complemento del historial por separado. No volver a crear/sobrescribir esos respaldos. Registrar rutas técnicas solo en evidencia privada y verificar sus SHA-256/modos |
| CUTOVER.md | Sustituir la creación de HOME por auditoría del HOME ya preparado. Insertar las puertas B–H2 de WINDOW_B_PLAN.md antes de cualquier parada/recreación. No suponer que existe una barrera desplegada ni que un acuerdo verbal cierra admisión |
| ACCEPTANCE.md | Mantener gate cerrado durante CLI y A→B→A. Arranque backend/warmup requiere autorización y recursos. HTTP de aceptación conserva sesión/CSRF y acceso exclusivo verificable; no abrir servicio general para probarlo |
| ROLLBACK_PRODUCTION.md | Leer historyFile y recent-workspaces desde el complemento, configuraciones desde principal; preservar ambos HOME. Reconciliar trabajos antes de restaurar y reabrir solo tras rollback verificado y autorización |

Las rutas de los dos respaldos y el HOME se toman de las referencias privadas ya
verificadas; no copiar historial ni autenticación a este directorio o al HOME nuevo.
Si algo cambió legítimamente desde el respaldo, parar y autorizar un nuevo
complemento, sin sobrescribir evidencia histórica.

Hoy no hay gate de admisión productivo: CUTOVER debe permanecer NO-GO en la puerta
B. Tampoco hay inventario remoto completo demostrado: una lista vacía parcial,
timeout, proceso por nombre o cliente Docker terminado no satisfacen D–G.
Las señales de parada no deben usarse para crear artificialmente un «drenaje».

La aceptación B debe resolver de antemano cómo probar HTTP sin abrir nuevas tareas
de terceros. Con el diseño actual, detener backend y luego arrancarlo no garantiza
esa exclusividad. No eliminar esta puerta para terminar el procedimiento.

Reapertura: autorización separada de startup/warmup y apertura general; verificar
identidad, listener, estado del modelo/recursos y ausencia de tareas desconocidas.
Si el supervisor relanza una generación nueva antes de la apertura autorizada,
NO-GO. Nunca reabrir automáticamente desde un bloque finally o un rollback.

Actualizar los manifiestos de promoción solamente después de una futura revisión
y autorización documental. No aplicar ahora el diff anterior ni este documento.
