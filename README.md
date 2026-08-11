# baby-gift-list

Lista de regalos para bebé. Web estática de un solo archivo HTML con backend en Supabase: autenticación real, base de datos con Row Level Security y actualizaciones en tiempo real.

## Qué hace

- El admin crea y gestiona la lista de regalos (añadir, editar, borrar, marcar como imprescindible o comprado)
- Los invitados acceden solo a través de un enlace con ID secreto y pueden reservar regalos
- Las reservas se actualizan en tiempo real para todos los que tienen la lista abierta
- Soporte para múltiples listas por admin

## Stack

- HTML + CSS + JS vanilla (sin framework)
- [Supabase](https://supabase.com) — auth, base de datos PostgreSQL con RLS, realtime
- [Supabase JS v2](https://github.com/supabase/supabase-js) vía CDN
- `build.mjs` — script de minificación y ofuscación (Node.js, sin bundler)

## Estructura

```
index.html      → fuente (editar aquí)
build.mjs       → script de build
dist/           → salida minificada (generada, no commiteada)
SUPABASE.md     → instrucciones de configuración de Supabase
```

## Desarrollo local

Necesitas Node.js 18+.

Abre `index.html` directamente en el navegador o usa cualquier servidor estático:

```bash
npx serve .
# o
python3 -m http.server 8080
```

No hay `npm install` ni proceso de compilación para desarrollo — edita `index.html` y recarga.

## Build para producción

```bash
node build.mjs
```

Genera `dist/index.html` minificado y listo para desplegar. La primera vez instala las dependencias necesarias automáticamente.

## Despliegue en Netlify

Conecta el repo y configura:

| Campo | Valor |
|---|---|
| Build command | `node build.mjs` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node version | `20` |

Estos valores ya están declarados en `netlify.toml`, así que Netlify los detecta automáticamente.

### Variables de entorno

| Variable | Descripción |
|---|---|
| `RESEND_API_KEY` | API key de [Resend](https://resend.com), usada por la función `netlify/functions/notify-reservation.js` para enviar el email de aviso a `reservas@unregaloparabea.es` cuando se reserva o cancela un regalo. Configúrala en **Site configuration → Environment variables** en Netlify. |

O arrastra directamente el `dist/index.html` a [app.netlify.com](https://app.netlify.com) (en ese caso las Netlify Functions no funcionarán; hace falta conectar el repo).

## Configuración de Supabase

Ver [SUPABASE.md](./SUPABASE.md).
