# Agentes Oficiales de LAB-IA

Versión: 1.0

---

# Introducción

Los agentes representan los distintos roles especializados de LAB-IA.

Cada uno tiene una única responsabilidad principal.

Elegir el agente correcto es parte del flujo de trabajo del laboratorio.

No existe un agente "mejor" que otro.

Existe un agente adecuado para cada tarea.

---

# Profesor

## Objetivo

Enseñar y guiar el aprendizaje.

## Cuándo utilizarlo

- Aprender una tecnología.
- Prepararse para un examen.
- Comprender un algoritmo.
- Resolver ejercicios paso a paso.
- Practicar entrevistas.

## Cuándo NO utilizarlo

- Cuando se necesite desarrollar un proyecto completo rápidamente.
- Cuando el objetivo sea únicamente implementar una solución.

## Trabaja especialmente bien con

- Senior Developer
- Reviewer

---

# Senior Developer

## Objetivo

Diseñar e implementar soluciones completas.

## Cuándo utilizarlo

- Crear proyectos nuevos.
- Agregar funcionalidades.
- Refactorizar código.
- Diseñar arquitectura.
- Automatizar procesos.

## Cuándo NO utilizarlo

- Cuando el objetivo sea únicamente aprender teoría.
- Cuando solamente se requiera revisar un proyecto.

## Trabaja especialmente bien con

- Reviewer
- Debugger
- SQL Expert
- Docker Expert

---

# Reviewer

## Objetivo

Evaluar la calidad del software.

## Cuándo utilizarlo

- Antes de un commit.
- Antes de una entrega.
- Antes de desplegar.
- Antes de fusionar ramas.

## Cuándo NO utilizarlo

- Para escribir proyectos completos desde cero.

## Busca

- Bugs
- Código duplicado
- Mala arquitectura
- Riesgos
- Problemas de seguridad

---

# Debugger

## Objetivo

Encontrar la causa raíz de un problema.

## Cuándo utilizarlo

- Excepciones.
- Errores.
- Configuración incorrecta.
- Docker.
- SQL.
- APIs.

## Cuándo NO utilizarlo

- Para desarrollar nuevas funcionalidades.

## Método

1. Reproducir.
2. Analizar.
3. Formular hipótesis.
4. Validar.
5. Corregir.
6. Verificar.

---

# SQL Expert

## Objetivo

Diseñar y optimizar bases de datos.

## Cuándo utilizarlo

- SQL Server.
- PostgreSQL.
- Optimización.
- Índices.
- Procedimientos.
- Triggers.
- Diseño.

## Cuándo NO utilizarlo

- Para revisar arquitectura general del proyecto.

---

# Docker Expert

## Objetivo

Administrar infraestructura basada en Docker.

## Cuándo utilizarlo

- Docker Compose.
- Redes.
- Contenedores.
- Permisos.
- Imágenes.
- Volúmenes.

## Cuándo NO utilizarlo

- Para desarrollar lógica de negocio.

---

# Prompt Engineer

## Objetivo

Mejorar continuamente LAB-IA.

## Cuándo utilizarlo

- Diseñar agentes.
- Corregir prompts.
- Auditar instrucciones.
- Evolucionar el laboratorio.

## Cuándo NO utilizarlo

- Para desarrollar proyectos de software.

---

# Flujo recomendado entre agentes

Aprendizaje

Profesor

↓

Senior Developer

↓

Reviewer

---

Desarrollo

Senior Developer

↓

Reviewer

↓

Debugger

---

Bases de datos

SQL Expert

↓

Reviewer

↓

Debugger

---

Infraestructura

Docker Expert

↓

Reviewer

↓

Debugger

---

Mejora del laboratorio

Prompt Engineer

↓

Reviewer

↓

Implementación

---

# Regla de Oro

Elegir el agente correcto suele ahorrar más tiempo que intentar resolver el problema con el agente equivocado.
