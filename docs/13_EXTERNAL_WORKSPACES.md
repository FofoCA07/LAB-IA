# Propósito

LAB-IA puede trabajar sobre proyectos externos almacenados en WSL o Windows sin copiarlos dentro del laboratorio. El proyecto conserva su ubicación y se utiliza directamente como workspace de OpenCode.

# Cómo funciona

LAB-IA mantiene sus agentes y configuración dentro de `/home/adolf/LAB-IA`. El proyecto externo se monta como `/workspace` dentro del contenedor OpenCode; los cambios realizados allí afectan los archivos del proyecto original.

La variable `LAB_WORKSPACE` controla qué proyecto se monta. Si no se define o está vacía, Compose usa `../` desde el directorio `docker`, manteniendo LAB-IA como workspace predeterminado.

`scripts/lab-open` automatiza la selección y verificación del workspace. Los ejemplos usan el comando `lab-open`, que requiere que el script esté disponible en `PATH`. También puede invocarse directamente como `/home/adolf/LAB-IA/scripts/lab-open`.

# Proyectos en WSL

Se usa la ruta Linux normal del proyecto:

```bash
lab-open /home/adolf/proyectos/MiProyecto
```

La ruta debe existir y corresponder a un directorio.

# Proyectos en Windows

Una ruta de Windows como:

```text
C:\Users\adolf\Documents\MiProyecto
```

equivale en WSL, con la unidad C montada en su ubicación habitual, a:

```text
/mnt/c/Users/adolf/Documents/MiProyecto
```

El proyecto se abre usando esa ruta de WSL:

```bash
lab-open /mnt/c/Users/adolf/Documents/MiProyecto
```

`lab-open` todavía no convierte automáticamente rutas `C:\...`; las rechaza y solicita una ruta de WSL.

# Qué hace lab-open

- Recibe exactamente una ruta y muestra el uso si la cantidad de argumentos es incorrecta.
- Valida que la ruta exista y sea un directorio.
- Resuelve la ruta absoluta real, incluidos los enlaces simbólicos del directorio.
- Localiza LAB-IA automáticamente a partir de la ubicación del propio script.
- Usa `docker compose` desde el directorio `docker` de LAB-IA.
- Define `LAB_WORKSPACE` y recrea únicamente el servicio `opencode`, sin recrear Ollama:

  ```bash
  LAB_WORKSPACE="<ruta>" docker compose up -d --force-recreate opencode
  ```

- Monta el proyecto como `/workspace`.
- Verifica que OpenCode esté en estado `running`.
- Comprueba que el workspace montado coincida con la ruta real solicitada.
- Informa el workspace solicitado, el resuelto, el montado y el estado de OpenCode.
- Muestra el contenido de `/workspace` mediante `ls -la`, un comando de solo lectura.

Si Docker o Compose falla, el script se detiene y muestra el error.

# Qué no hace

- No copia proyectos ni mueve archivos.
- No ejecuta comandos de eliminación de contenedores, imágenes, redes, volúmenes ni datos. La recreación solicitada de `opencode` sí reemplaza su contenedor anterior.
- No ejecuta `docker compose down`.
- No usa `sudo`.
- No modifica Ollama.

# Rutas con espacios

Las rutas con espacios deben ir entre comillas para enviarlas como un único argumento:

```bash
lab-open "/mnt/c/Users/adolf/Documents/Mi Proyecto"
```

# Flujo recomendado

1. Identificar la ruta del proyecto.
2. Convertirla a `/mnt/...` si vive en Windows.
3. Ejecutar `lab-open` con la ruta correspondiente.
4. Comprobar que el workspace montado sea el esperado y OpenCode esté en estado `running`.
5. Abrir OpenCode y trabajar normalmente sobre `/workspace`.

# Consideraciones

- Los proyectos intensivos en Docker/Linux suelen rendir mejor dentro del sistema de archivos de WSL.
- Los proyectos que deban permanecer en Windows pueden abrirse mediante `/mnt/c/...`.
- No es necesario mover un proyecto de Windows a WSL solo por usar LAB-IA.
- Usar Git para revisar el estado y conservar una referencia recuperable antes de cambios importantes.

# Ejemplos rápidos

WSL:

```bash
lab-open /home/adolf/proyectos/MiAPI
```

Windows:

```bash
lab-open /mnt/c/Users/adolf/Documents/FacturacionApp
```

Windows con espacios:

```bash
lab-open "/mnt/c/Users/adolf/Documents/Proyecto Java"
```

# Estado actual

Según las pruebas reportadas por el usuario, el soporte ya fue probado con:

- Workspace externo en WSL.
- Workspace externo en Windows.
- Montaje correcto como `/workspace`.
- OpenCode en estado `running`.

# Mejoras futuras

Quedan pendientes:

- Aceptar rutas `C:\...` directamente y convertirlas automáticamente.
- Incorporar un selector interactivo de proyectos.
- Mantener un historial de workspaces recientes.
- Evaluar una posible integración futura con una interfaz web.
