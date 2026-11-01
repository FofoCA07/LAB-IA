# Rollback futuro de META A — no ejecutado

Este candidato no está desplegado: hoy basta conservar los archivos activos.
No ejecutar comandos operativos de este documento sin autorización posterior.

## Preparación obligatoria antes de un eventual cutover

- Registrar proyecto `docker`, contenedor `opencode`, workspace montado,
  redes, imágenes, puertos, UID/GID, estado y StartedAt de producción.
- Guardar en respaldo privado verificable los archivos activos
  `docker/docker-compose.yml`, `docker/opencode.json` y `scripts/lab-open`.
  Incluir hashes y modos; no incluir secretos en Git ni en evidencias.
- Conservar HOME anterior, dependencias locales e imágenes en caché.
  Para un respaldo consistente de estado de OpenCode, drenar y parar ese servicio.
  No sobrescribir ni migrar automáticamente su HOME anterior al nuevo.
- No cambiar Ollama, su volumen `ollama`, publicación `127.0.0.1:11434`
  o redes. No tocar otros proyectos Docker ni el runtime privado del backend.
- Definir quién coordina la ventana: suspender activaciones y nuevos summaries,
  esperar trabajos en curso y comprobar que no quedan procesos OpenCode activos.
- Los paths de este Compose son relativos a candidates/5b10d. Si se promueve
  a otra ubicación, revisar todos los binds y repetir validación efectiva.

## Reversión operativa propuesta

Los comandos siguientes son ejemplos para una futura intervención. Definir
`BACKUP_META_A`, `WORKSPACE_ANTERIOR` y `LAB_ROOT_META_A` con valores verificados.
`COMPOSE_META_A` debe apuntar al archivo exacto usado al desplegar, no adivinarlo.

1. Drenar peticiones y mantener bloqueadas nuevas activaciones. Parar solamente
   el OpenCode nuevo y después retirar únicamente el servicio gateway nuevo:

```bash
docker compose -p docker -f "$COMPOSE_META_A" stop opencode
docker compose -p docker -f "$COMPOSE_META_A" stop opencode-gateway
docker compose -p docker -f "$COMPOSE_META_A" rm -f opencode-gateway
```

2. Restaurar desde el respaldo íntegro los tres archivos activos, incluyendo
   permisos de ejecución de `scripts/lab-open`. Hacerlo con OpenCode detenido:

```bash
cp -p -- "$BACKUP_META_A/docker-compose.yml" "$LAB_ROOT_META_A/docker/docker-compose.yml"
cp -p -- "$BACKUP_META_A/opencode.json" "$LAB_ROOT_META_A/docker/opencode.json"
cp -p -- "$BACKUP_META_A/lab-open" "$LAB_ROOT_META_A/scripts/lab-open"
```

3. Verificar hashes del respaldo, mounts/HOME anterior y provider directo.
   Validar configuración anterior antes de recrear únicamente OpenCode:

```bash
LAB_WORKSPACE="$WORKSPACE_ANTERIOR" docker compose -p docker -f "$LAB_ROOT_META_A/docker/docker-compose.yml" config --quiet
LAB_WORKSPACE="$WORKSPACE_ANTERIOR" docker compose -p docker -f "$LAB_ROOT_META_A/docker/docker-compose.yml" up -d --no-deps --force-recreate --pull never --no-build opencode
```

4. Confirmar `docker_default`, workspace RO, HOME anterior y provider original
   `http://host.docker.internal:11434/v1`. Comprobar backend y, solo si se autoriza,
   reviewer ficticio. Ollama debe conservar ID, StartedAt, redes, puertos y volumen.
5. Inspeccionar las redes nuevas. Solo si están vacías y sus etiquetas/nombres
   corresponden al despliegue, eliminarlas individualmente (`docker network rm`
   seguido de sus nombres exactos, previstos `docker_front` y `docker_upstream`).
   No eliminar `docker_default`, `bridge`, `sqlnet` ni `technova-network`.
6. Conservar el HOME nuevo hasta cerrar la incidencia; retirar sus datos según
   política específica después. No borrar imágenes ni volúmenes productivos.
7. Comparar inventario, configuración y Git; documentar resultado antes de reabrir
   operaciones. El ID y StartedAt de OpenCode cambian al recrearlo: rollback
   restaura función y configuración, no su identidad anterior ni una sesión activa.

No usar eliminación global, limpieza masiva ni borrado de volúmenes. No reiniciar
Ollama ni modificar firewall/sysctl. Si algo no coincide con el respaldo, detener
la reversión automática y conservar los recursos para diagnóstico.
