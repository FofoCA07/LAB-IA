# Solución de Problemas (Troubleshooting)

Versión: 1.0

---

# Objetivo

Este documento recopila los problemas encontrados durante el desarrollo de LAB-IA y sus respectivas soluciones.

Su propósito es evitar repetir investigaciones para problemas ya resueltos.

---

# Problema 1

## OpenCode intenta escribir archivos fuera del proyecto

### Síntoma

El agente intenta crear archivos en:

/
o
/path/to/project

### Causa

El agente asumía rutas en lugar de inspeccionar el proyecto.

### Solución

Agregar reglas de Workspace Discovery al agente.

Obligar al agente a:

- Ejecutar pwd.
- Inspeccionar el proyecto.
- Utilizar rutas relativas.

---

# Problema 2

## OpenCode no encuentra documentos

### Síntoma

El agente responde que no encuentra archivos como:

LAB-IA.md

### Causa

El documento estaba fuera del workspace.

### Solución

Mover la documentación a:

docs/

y montar todo LAB-IA como workspace.

---

# Problema 3

## El Prompt Engineer inventa recomendaciones

### Síntoma

Hace sugerencias sobre temas que no aparecen en el documento.

### Causa

El modelo rellenaba información usando conocimiento general.

### Solución

Agregar reglas de análisis basado únicamente en evidencia.

Nunca asumir información faltante.

---

# Problema 4

## El agente hace preguntas innecesarias

### Síntoma

Pregunta qué hacer aunque la tarea sea clara.

### Causa

No existían reglas de ejecución inmediata.

### Solución

Agregar reglas TASK EXECUTION.

Ejecutar primero.

Preguntar únicamente cuando realmente falte información.

---

# Problema 5

## Problemas de permisos

### Síntoma

Errores relacionados con permisos dentro del contenedor.

### Causa

Configuración incorrecta del usuario o del workspace.

### Solución

Revisar:

- docker-compose.yml
- Usuario
- HOME
- Volúmenes
- Workspace

---

# Buenas prácticas

Cuando aparezca un problema nuevo:

1. Describir el síntoma.
2. Encontrar la causa raíz.
3. Documentar la solución.
4. Explicar cómo evitarlo en el futuro.

---

# Regla General

Nunca resolver el mismo problema dos veces.

Si ya fue solucionado, debe quedar documentado en este archivo.
