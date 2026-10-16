# Base de autenticación local (fase de infraestructura)

Esta fase **no protege la API existente**: agents, conversations/messages/respond,
turns, actions/decision, workspaces y OpenCode/proposal/apply conservan su acceso
actual. No hay pantalla de pairing ni autorización multiusuario.

## Contrato HTTP de desarrollo

El navegador usa `/api/lab/api/auth/...` mediante Vite. El proxy elimina
`/api/lab`, preserva Host y no inyecta autoridad. Los pares aceptados son:

- Host `localhost:5173`, Origin `http://localhost:5173`.
- Host `127.0.0.1:5173`, Origin `http://127.0.0.1:5173`.

Un Host de un par no admite el Origin del otro. No se confía en ningún header
`X-Forwarded-*`. No hay excepción por dirección loopback. El backend mantiene
su listener en `127.0.0.1:3001`, pero `Host: 127.0.0.1:3001` no es parte de este
contrato de navegador. Los clientes no navegador pueden falsificar Host/Origin;
estos controles no sustituyen la sesión ni el conocimiento del código.

Vite actualmente puede elegir otro puerto si 5173 está ocupado. En ese caso
auth falla cerrado: liberar 5173 o revisar explícitamente la configuración de
orígenes antes de usar auth. No se autodetectan orígenes desde requests.

- `POST /api/auth/pair`: Origin obligatorio, JSON exacto `{ "code": "..." }`.
  Código base64url canónico de 43 caracteres (32 bytes). Éxito: únicamente
  `{ "authenticated": true }` y Set-Cookie. Código incorrecto, expirado o
  consumido: mismo error 401. No genera códigos.
- `GET /api/auth/session`: requiere `X-Lab-Request: 1`. Origin puede faltar,
  como sucede en fetch GET same-origin; si existe debe coincidir exactamente.
  `Sec-Fetch-Site`, cuando existe, debe ser `same-origin`. Sin sesión devuelve
  `{ "authenticated": false }`; con sesión, añade únicamente `csrfToken`.
- `POST /api/auth/logout`: Origin, cookie válida, `X-Lab-CSRF` y JSON exacto
  `{}`. Revoca sesión y devuelve `{ "authenticated": false }`.

Todos los POST requieren `application/json` (se admite `charset=utf-8`), cuerpo
máximo de 1024 bytes y plazo de 5 segundos. Se rechazan query strings. Errores
fijos; las conexiones rechazadas se cierran después de enviar la respuesta.
Todas las respuestas auth usan no-store, nosniff y no-referrer. No hay CSP global.

## Autoridad efímera

`createSecurityStore()` no hace I/O ni genera/imprime secretos al importarse.
`store.createPairing()` es una API **interna**, solo accesible desde código del
proceso backend. Usa `randomBytes(32)`; devuelve el código únicamente al llamador
y conserva su SHA-256. Regenerar invalida el anterior. TTL exacto: 120 segundos.
El canje y la creación de sesión son síncronos, sin una ventana await.

Límite global: 5 canjes intentados en una ventana móvil de 60 segundos, incluidos
los exitosos; generar otro código o cambiar headers no lo reinicia. Los bodies
malformados se rechazan antes del canje. Respuesta 429 con Retry-After.
Máximo de 64 sesiones simultáneas. El límite es global intencionalmente porque
IP/forwarded no representan identidades confiables en esta arquitectura local.

ID de sesión y CSRF independientes, de 256 bits. El mapa retiene el hash del ID,
CSRF y tiempos; nunca prompts/conversaciones. Expiración idle: 30 minutos;
absoluta: 8 horas. Solo una consulta de sesión válida actualiza la actividad en
esta fase; validar CSRF por sí solo no extiende el tiempo. El futuro middleware
deberá actualizar actividad tras autorizar una solicitud. Los plazos usan reloj
monotónico; los timestamps informativos internos usan reloj de pared.
Logout elimina la sesión. Cleanup periódico cada 30 segundos y en cada acceso;
un registro ya expirado nunca autoriza aunque todavía no lo borró el timer.
Reiniciar el backend invalida códigos, sesiones y rate limit.

Cookie de desarrollo, sin valores reales:

```text
lab_session=<ID_OPACO>; Path=/api/lab; HttpOnly; SameSite=Strict; Max-Age=28800
```

No contiene CSRF ni Domain. Max-Age es el techo absoluto; el servidor puede
invalidar antes por inactividad. Logout usa valor vacío y Max-Age=0. En despliegue
HTTPS deberá añadirse Secure; esta configuración HTTP no ofrece esa garantía.
Las cookies no se aíslan por puerto y Path no es una frontera de seguridad.
HttpOnly no evita que un XSS opere con la sesión. La sesión no protege archivos
del SO ni frente a malware del mismo usuario.

## Disparador de terminal

Un CLI Node independiente crea otro store, no puede operar el store del backend
por importar el módulo. No se ha añadido archivo de intercambio, variable
persistente, endpoint generador ni IPC.

Arrancar el backend en una terminal interactiva:

```sh
npm run server
```

Luego escribir en **esa misma terminal**, sin argumentos:

```text
pair
```

El mismo proceso llama a `createPairing()` sobre el store compartido con auth y
muestra el código directamente al terminal una sola vez. No hay generación al
arrancar ni al importar el módulo. Todavía no existe pantalla frontend de canje.

Solo se activa si stdin **y** stdout tienen `isTTY === true`. Con pipelines,
redirecciones o sin TTY no escucha comandos ni emite códigos; el servidor sigue
funcionando. También revalida TTY antes de generar. No usa modo raw, no intercepta
Ctrl+C ni registra handlers globales de señales. `close()` libera los listeners;
el cierre del servidor también lo llama. Los errores del store/streams cierran
el componente sin imprimir detalles ni reintentar la salida.

Solo se acepta `pair`, ignorando espacios exteriores. Comandos desconocidos se
ignoran. El código es válido durante dos minutos y single-use. Otro `pair`
invalida inmediatamente el anterior; como máximo hay uno activo. Generarlo no
crea sesión y no consume intentos de canje HTTP; tampoco reinicia ese rate limit.
La sesión solo nace al canjear por `POST /api/auth/pair`. Reiniciar el backend
invalida pairing y sesiones.

El store conserva solo el hash del código. El valor completo existe
transitoriamente en la llamada y en la escritura al terminal; no se retiene en
el componente. El terminal/emulador puede conservar su scrollback o estar siendo
grabado: `isTTY` evita redirecciones ordinarias, no garantiza confidencialidad
frente a grabación o malware. No se envía a console/logger, archivos, HTTP,
SQLite, telemetry, argumentos de proceso ni variables persistentes.
