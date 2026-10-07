# Estándares de Desarrollo de LAB-IA

Versión: 1.0

---

# Objetivo

Este documento define los estándares generales utilizados en LAB-IA.

El objetivo es mantener todos los proyectos organizados, fáciles de entender y sencillos de mantener.

La prioridad siempre será escribir software claro antes que software complejo.

---

# Filosofía

Siempre priorizar:

- Claridad.
- Simplicidad.
- Mantenibilidad.
- Consistencia.
- Legibilidad.

Evitar soluciones innecesariamente complejas.

---

# Organización del proyecto

Cada proyecto debe tener una estructura clara.

Las carpetas deben tener un propósito definido.

Evitar crear carpetas innecesarias.

---

# Código

Siempre:

- Utilizar nombres descriptivos.
- Escribir funciones con una única responsabilidad.
- Evitar código duplicado.
- Evitar funciones excesivamente largas.
- Mantener una estructura consistente.

---

# Comentarios

Los comentarios deben explicar el "por qué", no el "qué".

Evitar comentar código evidente.

Comentar únicamente cuando aporte valor.

---

# Variables

Los nombres deben describir claramente su propósito.

Evitar abreviaturas innecesarias.

Preferir claridad antes que nombres demasiado cortos.

---

# Funciones

Cada función debe realizar una sola tarea.

Si una función empieza a hacer demasiadas cosas, considerar dividirla.

---

# Clases

Cada clase debe representar una responsabilidad principal.

Evitar clases demasiado grandes.

---

# Manejo de errores

Nunca ignorar errores.

Siempre intentar identificar la causa.

Los mensajes de error deben ayudar a entender el problema.

---

# SQL

Preferir consultas legibles.

Evitar SELECT * salvo que exista una razón válida.

Nombrar claramente alias y columnas.

Optimizar únicamente cuando sea necesario.

---

# Docker

Mantener imágenes simples.

Evitar configuraciones innecesarias.

Documentar cambios importantes.

---

# Git

Realizar commits pequeños y descriptivos.

Evitar mezclar cambios sin relación.

Mantener un historial fácil de entender.

---

# Documentación

Actualizar la documentación cuando un cambio afecte el funcionamiento del proyecto.

No dejar documentación desactualizada.

---

# Regla de Oro

Antes de escribir código, preguntarse:

"¿Dentro de seis meses entenderé fácilmente esto?"

Si la respuesta es no, probablemente pueda escribirse mejor.
