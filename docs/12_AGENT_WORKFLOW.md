# Propósito

LAB-IA usa agentes especializados con responsabilidades separadas. Este documento define el flujo oficial de coordinación entre ellos: cuándo intervienen, qué entregan y dónde termina su responsabilidad.

No todos los agentes deben participar en todas las tareas. El usuario selecciona los necesarios según el objetivo, el alcance y la complejidad del trabajo.

# Agentes actuales

| Agente | Responsabilidad principal | Cuándo usarlo | Cuándo no usarlo | Tipo de intervención |
| --- | --- | --- | --- | --- |
| Software Architect | Diseñar la arquitectura y planificar la solución. | Decisiones de estructura, interfaces, dependencias o cambios importantes de arquitectura. | Correcciones puntuales sin decisiones estructurales o implementación de código. | Diseña y planifica; no implementa. |
| Senior Developer | Implementar cambios dentro del alcance y diseño acordados. | Funcionalidades, refactorizaciones y correcciones autorizadas. | Revisión independiente, diagnóstico sin causa conocida o rediseño arquitectónico sin autorización. | Implementa y verifica sus cambios. |
| Reviewer | Evaluar cambios y detectar problemas de calidad, seguridad y mantenibilidad. | Revisar una implementación antes de su entrega o integración. | Implementar funcionalidades o corregir directamente los hallazgos de su revisión. | Revisa y recomienda correcciones. |
| Debugger | Investigar fallos y determinar su causa raíz. | Errores reproducibles, excepciones o comportamientos inesperados. | Crear funcionalidades o implementar correcciones como parte del diagnóstico. | Diagnostica y recomienda una corrección mínima. |
| Docker Expert | Resolver necesidades de infraestructura basada en Docker. | Imágenes, Dockerfiles, Compose, redes, volúmenes y configuración de contenedores. | Lógica de negocio o infraestructura ajena a Docker. | Diseña, diagnostica o implementa cambios de Docker dentro del alcance autorizado. |
| SQL Expert | Diseñar y optimizar bases de datos y consultas. | Esquemas, consultas, índices, procedimientos y migraciones de datos. | Arquitectura general de la aplicación o lógica ajena a la base de datos. | Diseña, diagnostica o implementa cambios de base de datos dentro del alcance autorizado. |
| Profesor | Enseñar conceptos y explicar código. | Aprendizaje, ejercicios guiados y comprensión de tecnologías. | Entregas de producción cuyo objetivo sea implementar una solución. | Enseña. |
| Prompt Engineer | Mantener y mejorar las instrucciones de los agentes. | Crear agentes, ajustar prompts, auditar reglas y resolver ambigüedades entre roles. | Implementar funcionalidades del producto o investigar fallos de la aplicación. | Mantiene agentes. |

La verificación del Senior Developer corresponde a su implementación; no sustituye la revisión independiente del Reviewer. Los especialistas implementan únicamente en su dominio y en archivos asignados, sin duplicar el trabajo del Senior Developer.

# Flujo principal de desarrollo

Software Architect → Senior Developer → Reviewer → Debugger si existe un fallo.

- **Software Architect:** diseña y planifica; entrega decisiones y criterios de aceptación.
- **Senior Developer:** implementa el alcance acordado y verifica el resultado.
- **Reviewer:** revisa la implementación y entrega hallazgos priorizados.
- **Debugger:** investiga fallos cuando aparecen y entrega la causa raíz con evidencia.

Este flujo representa un orden recomendado, no una ejecución automática. Si la revisión requiere ajustes, el usuario puede devolver los hallazgos al Senior Developer. Si existe un fallo, el Debugger puede intervenir en la etapa donde se detecte; una corrección posterior requiere que el usuario seleccione y autorice al agente responsable.

# Especialistas

- **SQL Expert:** interviene cuando el alcance requiere diseño, diagnóstico u optimización de bases de datos. Entrega consultas, decisiones de esquema o cambios específicos de su dominio.
- **Docker Expert:** interviene cuando se requiere infraestructura Docker. Entrega configuraciones, diagnósticos o cambios de contenedores necesarios para la solución.
- **Profesor:** interviene cuando el objetivo es aprender o comprender una parte del trabajo. No es una etapa obligatoria del desarrollo.
- **Prompt Engineer:** interviene para mejorar los agentes y sus reglas. Su alcance es el sistema de agentes, no el producto desarrollado.

Antes de incorporar un especialista, se delimitan su objetivo, los archivos que puede modificar y el resultado esperado. Sus entregables sirven de entrada a la etapa correspondiente.

# Tipos de tarea

## Tarea pequeña

Ejemplos: corrección puntual, cambio pequeño o ajuste de una función.

**Flujo sugerido:** Senior Developer → Reviewer si el cambio lo justifica → Debugger solo si falla.

La revisión se recomienda cuando el cambio afecta comportamiento relevante, seguridad o código difícil de verificar. No se requiere Architect si no hay decisiones de estructura.

## Tarea mediana

Ejemplos: nueva funcionalidad, módulo pequeño o cambios en varios archivos relacionados.

**Flujo sugerido:** Software Architect si hay decisiones de estructura → Senior Developer → Reviewer → Debugger si falla.

El diseño debe delimitar los componentes afectados y sus interfaces. Los especialistas participan únicamente si hay trabajo de su dominio.

## Tarea grande

Ejemplos: nueva aplicación, migración, cambio importante de arquitectura o trabajo en múltiples módulos.

**Flujo sugerido:** Software Architect → especialistas necesarios → Senior Developer → Reviewer → Debugger si falla.

El Architect divide el trabajo en entregas incrementales y define dependencias. Los especialistas resuelven las partes asignadas antes de que el Senior Developer implemente o integre lo restante. Cada entrega debe poder verificarse y revertirse.

# Reglas de coordinación

- Ningún agente debe asumir responsabilidades de otro. Si el trabajo excede su rol, entrega el contexto y señala qué intervención se necesita.
- No invocar agentes automáticamente sin que el usuario lo solicite o exista una regla futura de orquestación explícita y aplicable.
- No continuar automáticamente con otra etapa. Completar la etapa actual y entregar su resultado al usuario.
- Cada etapa debe entregar un resultado claro al siguiente agente.
- Los cambios deben ser verificables y reversibles, con un alcance definido.
- No usar varios agentes para hacer el mismo trabajo; asignar responsabilidades y archivos sin solapamientos.
- Los especialistas intervienen solo cuando el alcance los requiere.

# Handoffs entre agentes

Un handoff es la entrega de contexto y resultados para que otro agente pueda continuar sin repetir el trabajo. Debe indicar el objetivo, el alcance autorizado, el estado actual, la evidencia disponible y los asuntos pendientes. No transfiere permisos adicionales ni autoriza por sí mismo otra etapa.

## Architect → Senior Developer

- Objetivo y resultado esperado.
- Estructura propuesta, componentes e interfaces.
- Decisiones tomadas y su justificación.
- Restricciones técnicas y de alcance.
- Criterios de aceptación verificables.

## Senior Developer → Reviewer

- Archivos modificados.
- Resumen de los cambios y relación con el objetivo.
- Verificaciones realizadas y resultados.
- Limitaciones, riesgos conocidos o verificaciones pendientes.

## Reviewer → Senior Developer

- Hallazgos priorizados según gravedad e impacto.
- Evidencia: archivo, ubicación y comportamiento observado.
- Corrección recomendada y criterio para verificarla.

## Debugger → Senior Developer

- Causa raíz; si no está confirmada, hipótesis y datos pendientes.
- Evidencia y pasos para reproducir el fallo.
- Corrección mínima recomendada y forma de comprobarla.

## Especialistas → agente que continúa

- Decisiones o cambios realizados dentro de su dominio.
- Archivos afectados, dependencias y requisitos de integración.
- Verificaciones realizadas, restricciones y asuntos pendientes.

# Seguridad

- Preservar los cambios existentes del usuario y de otros agentes; no sobrescribirlos ni revertirlos sin autorización.
- Usar Git para inspeccionar el estado, revisar diferencias y preparar una reversión controlada de los cambios propios.
- No hacer commit o push automáticamente; requieren una solicitud explícita del usuario.
- Evitar operaciones destructivas sin autorización, incluidas eliminaciones de datos, volúmenes o cambios de historial.
- Proteger secretos y archivos sensibles: no exponer credenciales en respuestas, registros, diffs o handoffs.
- Limitar el alcance de cada agente a los archivos, herramientas y permisos necesarios para su tarea.

# Flujo manual actual

Actualmente el usuario selecciona qué agente usar y pasa manualmente el resultado de una etapa a otra. Cada agente completa su tarea, informa qué hizo y entrega el contexto necesario para continuar.

Las flechas de los flujos indican posibles transiciones. El usuario decide si corresponde pasar a la siguiente etapa, solicitar ajustes o finalizar el trabajo.

# Orquestación futura

Una evolución futura podrá incorporar:

- Selección automática de agentes según el objetivo y el alcance.
- Coordinación entre agentes con responsabilidades delimitadas.
- Handoffs automáticos con contexto y evidencia suficientes.
- Ejecución secuencial controlada, con condiciones de avance y parada.

Estas capacidades no están habilitadas por este documento. Su incorporación debe mantener los límites de cada rol, los permisos aplicables y la trazabilidad de decisiones, acciones y resultados.

# Ejemplos de uso

- **"Corrige este error"** → Debugger → Senior Developer si se autoriza la corrección.
- **"Agrega autenticación"** → Software Architect → Senior Developer → Reviewer.
- **"Optimiza esta consulta"** → SQL Expert.
- **"Explícame este código"** → Profesor.
- **"Mejora las reglas del Reviewer"** → Prompt Engineer.

Cada transición se realiza manualmente bajo decisión del usuario, según el flujo actual.

# Final

LAB-IA prioriza simplicidad, especialización, seguridad, trazabilidad, cambios incrementales y verificación. Cada tarea debe usar los agentes necesarios y terminar con un resultado claro, comprobable y dentro del alcance autorizado.
