# Reconciliación propuesta — NO APLICADA

Los cuatro runbooks en promotion/ y sus hashes permanecen intactos. El archivo
`RUNBOOK_CORRECTIONS.diff` es una propuesta documental para revisión posterior:
no ejecutarlo ni aplicarlo en esta fase. No es un script de cutover.

## Dos respaldos privados, ninguno se sobrescribe

Principal existente:
`~/.local/state/lab-ia-meta-a/backups/20261101T234156.176231Z`.
Complemento selectivo:
`~/.local/state/lab-ia-meta-a/backups/5b10l-history-20261101T234739.962170Z`.

Definir por separado BACKUP_META_A e HISTORY_BACKUP_META_A. El primero aporta
config/{docker-compose.yml,opencode.json,lab-open}, metadata-before.json y las
referencias originales. El segundo aporta config/recent-workspaces, references.json
con historyFile/baseBackup y history-verification.json. No elegir «último backup».
Resolver ambos paths canónicos sin symlinks; exigir propietario y 0700/0600.
Validar SHA256SUMS en ambos, además PRECHECKS.sha256 del complemento, y contrastar
baseBackup más hashes registrados contra el principal. No fusionar/sobrescribir
directorios para que el runbook anterior parezca compatible.

Leer workspace/oldHome del principal; historyFile del complemento. Ambos conjuntos
de referencias deben coincidir en workspace/HOME. Verificar que el historial
original seguía autorizado y que el archivo actual no cambió desde ese respaldo.
Si cambió, detener y autorizar un nuevo complemento selectivo antes de intervenir;
no restaurar una historia antigua sobre cambios legítimos inadvertidos.
No respaldar SQLite, credenciales, sesiones o el directorio runtime completo.

Para aceptación y rollback futuro, cp del historial debe tomar como origen
HISTORY_BACKUP_META_A/config/recent-workspaces, nunca un archivo ausente del
principal. Conservar su modo original 0600, hash, UID/GID y referencia de origen.
Un rollback posterior a pruebas de aceptación deberá restaurar conscientemente
ese punto histórico bajo la ventana exclusiva, no exigir igualdad con las rutas
sintéticas que la propia aceptación añadió de forma autorizada.

## HOME existente: verificar, no volver a preparar

`~/.local/share/lab-ia-opencode/home-meta-a` ya existe. No ejecutar otra vez
prepare_home.py --prepare-new-home: su rechazo de sobrescritura es correcto.
En la fase siguiente sustituir ese paso por una comprobación de solo lectura:

1. Ruta canónica, sin symlinks, UID/GID 1000:1000; dirs 0700 y files 0600.
2. Auditoría del cierre mediante funciones audit/resolution de home-audit.py,
   usando explícitamente HOME nuevo/.config/opencode como source, no su CLI
   predeterminada que audita el HOME anterior. Importar Python sin crear pycache.
3. Comparar packages/direct/edges/absentOptional/missingRequired y las 32
   resoluciones con HOME_INVENTORY.json; rechazar archivos inesperados.
4. Verificar solo manifiestos, 27 paquetes y mountpoints técnicos; sin auth,
   sesiones, SQLite, historial o credenciales. No importar código de paquetes.
5. Mantener distinción 7 SRI frente a 20 versiones/hashes locales. No afirmar
   autenticidad completa ni que la lectura prueba ejecución Bun tras cambios.

Ante fallo no reparar copiando HOME real, no instalar ni borrar/recrear el HOME.
El HOME anterior permanece físicamente intacto para rollback.

## Barrera, drenaje y cutover

Este candidato NO está integrado. Ningún runbook puede sustituir la ventana
exclusiva por un contador simulado o por docker top solamente. Integrar/probar
primero conforme a INTEGRATION_PLAN.md, con nuevo checkpoint de fuentes revisadas.

Puertas propuestas:

1. Revalidar Git/paquete, ambos backups y HOME. Memoria sigue CONDICIONAL.
2. Preparar/verificar Gateway solo si se autoriza esa fase; Ollama sin cambios.
3. Cerrar admisión mediante control local autorizado: DRAINING. Conservar consultas
   seguras autenticadas; bloquear summary, activación, chat, acciones y propuestas.
4. Esperar trabajos reales, procesos, recursos remotos y continuaciones. Sin
   incertidumbres ni fault/recoveryRequired. Verificar exclusividad de CLI externas.
5. Confirmar MAINTENANCE solo entonces. Si no puede probarse ausencia: NO-GO.
6. Ejecutar pasos de parada/recreación SOLO con autorización de cutover. No crear
   redes ni modificar archivos simplemente por seleccionar un workspace.
7. Mantener admisión normal cerrada durante aceptación. Autorizar diagnóstico
   exacto, de un solo uso, registrado; no desactivar la barrera para «probar».
8. CLI/reviewer y prueba HTTP backend son dos invocaciones principales distintas,
   autorizadas separadamente, sin retries manuales. El HTTP conserva sesión y CSRF;
   su concesión administrativa todavía requiere implementación y tests.
9. Después de cada diagnóstico, esperar recursos reales y volver a confirmar.
10. Tras aceptación funcional/red, regresar al workspace/historial originales,
    verificar memoria/servicios y solo entonces ordenar reopen explícito.

Los callbacks locales candidatos no implementan todavía las pruebas reales ni
el permiso HTTP de una sola operación. No afirmar aceptación completa sin ello.

## Fallos y rollback

No modificar Ollama, redes compartidas o volúmenes; no prune, down -v ni borrado
del HOME anterior. Si falla una puerta previa a parar OpenCode, no continuar.
Si ya hubo cutover, conservar barrera cerrada, diagnosticar trabajos activos y
seguir rollback autorizado usando principal + complemento. No liberar contadores
por timeout ni ocultar trabajo incierto para poder restaurar.

Si el rollback falla parcialmente, conservar ambos HOME, respaldos y recursos
identificados; no continuar retirando redes/servicios. Eliminar solo recursos
nuevos cuya identidad y ausencia de endpoints se hayan confirmado. Restaurar la
configuración anterior no recupera ID/StartedAt ni sesiones activas del contenedor.
Reabrir solo tras recuperar invariantes y funcionamiento del backend.

## Memoria y autorización pendiente

No se mide inferencia en 5B.10M. Gateway: 256 MiB y 0,5 CPU. Ni Ollama inactivo
ni el mock acreditan el pico qwen3:8b. Los 2 GiB preliminares no garantizan cualquier
carga. Definir y autorizar una medición controlada con muestras antes/durante,
picos, swap/paginación, OOM/reinicios e impacto en otras aplicaciones. No sumar
Windows y WSL como reservas independientes. Preservar límites 110/120/105 s.

La aplicación futura del diff cambia documentos cubiertos por MANIFEST.sha256:
requiere auditoría y actualización explícita del manifiesto y tests, jamás
deshabilitar el verificador para aceptar diferencias.

## Decisión posterior 5B.10O: rama operativa B aún no autorizada

ASSEMBLY_FINDINGS.md sustituye la recomendación provisional de integrar A: el
contrato remoto actual no aporta identidad suficiente. Para META A se recomienda
diseñar/ensayar una ventana operativa B antes de añadir seguimiento productivo.
No se ha detenido el backend ni se ha aplicado esta rama.

Mantener ambas fuentes de respaldo y validar HOME existente como se indica arriba.
Una futura rama B debe identificar el backend y trabajos activos, garantizar una
ventana exclusiva, bloquear nuevos clientes y autorizar parada controlada del
backend. Confirmar listener ausente NO basta: inspeccionar por separado procesos
OpenCode/Compose y trabajo remoto respecto a un baseline idle verificable. Si
quedan procesos desconocidos o no se puede asegurar exclusividad, NO-GO.

La aceptación CLI controlada, cambio de workspace y rollback se realizarían con
backend cerrado y autorización específica. La aceptación HTTP requiere una fase
explícita de arranque controlado, sesión/CSRF existentes y exclusividad del operador;
al arrancar el código actual se inicia warmup. Autorizar esa carga y comprobar
recursos antes de reabrir. Si falla, volver a cerrar admisión por el procedimiento
autorizado, comprobar trabajo pendiente y usar los respaldos adecuados; nunca
restaurar o retirar redes con un trabajo activo desconocido.

No mezclar la rama B con comandos de socket de una barrera que aún no está
desplegada. promotion/ sigue sin cambios; requiere una revisión posterior del
procedimiento elegido, pruebas de reversión y autorización antes de ejecutarse.
