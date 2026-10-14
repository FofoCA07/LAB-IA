# Guía de uso de LAB-IA

## 1. Qué es LAB-IA

LAB-IA es un laboratorio local de inteligencia artificial para trabajar con proyectos reales. Puedes conversar con agentes especializados, consultar dudas y generar propuestas de cambio. Después de revisar una propuesta, puedes autorizar que se aplique a los archivos del proyecto.

## 2. Cómo iniciar LAB-IA

Primero, asegúrate de que Ollama esté disponible y tenga el modelo `qwen3:8b` instalado.

Abre una terminal para el backend:

```bash
cd /home/adolf/LAB-IA/proyectos/lab-ia-web
npm run server
```

El backend precarga el modelo automáticamente. Puedes ver estos mensajes:

```text
LAB-IA: Ollama warmup loading
LAB-IA: Ollama warmup ready
```

`loading` significa que el modelo se está cargando. `ready` significa que ya está preparado. La primera carga puede tardar; no necesitas calentarlo manualmente.

En otra terminal, inicia el frontend:

```bash
cd /home/adolf/LAB-IA/proyectos/lab-ia-web
npm run dev
```

Abre en el navegador la dirección que muestra Vite. Mantén ambas terminales abiertas mientras uses LAB-IA.

## 3. Proyectos

En **Proyectos**, selecciona el proyecto que quieres usar y pulsa **Activar workspace**. Seleccionar un proyecto en la lista no lo activa por sí solo.

Comprueba el workspace activo antes de analizar, generar una propuesta o aplicar cambios. Estas acciones trabajan sobre el proyecto activo, así que conviene verificarlo cada vez que cambies de proyecto.

## 4. Chat

El chat sirve principalmente para conversar, consultar dudas y trabajar con los agentes. Puedes pedir explicaciones, discutir una solución o preparar una solicitud de cambio.

La integración para modificar archivos directamente desde el chat todavía es una función futura. Para generar y aplicar cambios, utiliza **Propuesta de cambio** en **Configuración**.

## 5. Agentes

En **Agentes**, puedes elegir quién te ayudará en la conversación:

- **Software Architect:** ayuda a organizar la estructura y las decisiones de un proyecto.
- **Senior Developer:** ayuda con implementación y dudas de programación.
- **Reviewer:** revisa código y señala posibles mejoras.
- **Debugger:** ayuda a encontrar y entender errores.
- **Docker Expert:** ayuda con contenedores y Docker.
- **SQL Expert:** ayuda con consultas y bases de datos.
- **Profesor:** explica conceptos y guía el aprendizaje paso a paso.
- **Prompt Engineer:** ayuda a escribir solicitudes más claras para los modelos.

## 6. Propuesta de cambio

En **Configuración**, busca **Propuesta de cambio**, escribe lo que quieres hacer y pulsa **Generar propuesta**.

El flujo es:

Escribir solicitud → LAB-IA analiza → muestra resumen y diff → todavía no modifica archivos.

Importante: Generar propuesta nunca modifica el proyecto. El cambio solo se realiza cuando revisas el diff y pulsas Aplicar cambio.

Por ejemplo:

```text
En README.md, reemplaza el contenido actual por:
LAB-IA funcionando correctamente.
```

El diff muestra qué líneas se quitarían y cuáles se agregarían. Revisa también los archivos afectados y el proyecto indicado.

## 7. Aplicar cambio

Después de revisar el diff:

1. Pulsa **Aplicar cambio**.
2. Lee la confirmación.
3. Confirma si estás de acuerdo.

LAB-IA modifica los archivos reales y muestra el resultado. Durante la operación, el botón indica **Aplicando...**.

La aplicación no hace commit, push ni staging. Git queda con los archivos modificados normalmente, pendientes de tu revisión.

Por ejemplo, al ejecutar en el proyecto:

```bash
git status --short
```

Puedes ver:

```text
 M README.md
```

El espacio inicial indica que el cambio no está en staging.

## 8. Seguridad

El modelo propone, el backend valida, tú autorizas y Git verifica el cambio antes de aplicarlo. No hay commit ni push automático.

Una propuesta expira a los 10 minutos. Si pasa ese tiempo, genera otra. Una propuesta aplicada no puede reutilizarse; si necesitas otro cambio, pide una nueva.

## 9. Errores comunes

- **Ollama warmup loading:** espera a que aparezca `ready`. Si la carga falla, comprueba que Ollama esté disponible.
- **Propuesta expirada:** genera una nueva propuesta y vuelve a revisar el diff.
- **Workspace con cambios:** ejecuta `git status` en el proyecto y revisa los cambios pendientes antes de generar otra propuesta.
- **Error al aplicar:** revisa manualmente los archivos antes de intentar otra cosa. Puede haber cambios parciales. No vuelvas a usar la misma propuesta.

## 10. Cómo detener LAB-IA

Pulsa **Ctrl + C** en la terminal del backend y también en la del frontend.

## 11. Flujo recomendado

Proyecto activo → conversar o analizar → generar propuesta → revisar diff → aplicar → revisar `git status` → probar el proyecto → hacer commit manual cuando estés conforme.

Antes del commit, comprueba que los cambios hacen lo que pediste y que el proyecto sigue funcionando.
