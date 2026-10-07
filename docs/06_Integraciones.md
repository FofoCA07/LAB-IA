# Integraciones de LAB-IA

Versión: 1.0

---

# Objetivo

Este documento describe cómo utilizar LAB-IA junto con las principales herramientas de desarrollo.

No explica la instalación de cada herramienta, sino la forma recomendada de utilizarlas dentro del flujo de trabajo del laboratorio.

---

# OpenCode

Es el centro del laboratorio.

Todos los agentes trabajan mediante OpenCode.

Antes de comenzar cualquier tarea:

1. Abrir el proyecto.
2. Seleccionar el agente adecuado.
3. Analizar el proyecto.
4. Comenzar el trabajo.

---

# Visual Studio Code

Uso recomendado para:

- Python
- JavaScript
- TypeScript
- React
- Node.js
- Archivos Markdown

Flujo recomendado:

Abrir proyecto

↓

Senior Developer

↓

Desarrollo

↓

Reviewer

↓

Commit

---

# IntelliJ IDEA

Uso recomendado para:

- Java
- Maven
- Spring
- OpenXava

Flujo recomendado:

Abrir proyecto

↓

Senior Developer

↓

Docker Expert (si aplica)

↓

Reviewer

↓

Commit

---

# Visual Studio

Uso recomendado para:

- C#
- .NET
- ASP.NET
- Windows Forms

Flujo recomendado:

Abrir proyecto

↓

Senior Developer

↓

Debugger (si existe algún error)

↓

Reviewer

↓

Commit

---

# Docker

Docker proporciona un entorno de desarrollo reproducible.

Siempre que un proyecto utilice Docker:

- Revisar Dockerfile.
- Revisar docker-compose.yml.
- Validar permisos.
- Validar volúmenes.
- Validar redes.

Para cualquier problema relacionado con Docker utilizar Docker Expert.

---

# Git

Todo proyecto debería estar versionado.

Buenas prácticas:

- Commits pequeños.
- Mensajes claros.
- No mezclar cambios sin relación.

---

# GitHub

GitHub será el repositorio oficial de los proyectos cuando se requiera compartirlos o mantener un historial remoto.

Antes de subir un proyecto:

- Revisar código.
- Actualizar documentación.
- Confirmar funcionamiento.

---

# Ollama

Ollama proporciona el modelo de lenguaje utilizado por LAB-IA.

No modificar la configuración sin conocer el impacto del cambio.

---

# Qwen

Actualmente LAB-IA utiliza Qwen como modelo principal.

Las futuras actualizaciones del modelo deberán documentarse en el Roadmap y en el Changelog.

---

# Regla General

Las herramientas pueden cambiar con el tiempo.

El flujo de trabajo de LAB-IA debe mantenerse consistente independientemente del editor utilizado.
