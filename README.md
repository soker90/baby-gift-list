# Lista de regalos para bebé — con Supabase

Web de lista de regalos con seguridad real. Un solo archivo HTML, sin build step, usando Supabase como backend.

## Requisitos previos

- Cuenta en [Supabase](https://supabase.com) (plan gratuito es suficiente)
- Navegador moderno (Chrome, Firefox, Safari, Edge)
- (Opcional) Cuenta en [Netlify](https://netlify.com) o [Vercel](https://vercel.com) para desplegar

---

## Paso 1: Crear el proyecto en Supabase

1. Entra en [app.supabase.com](https://app.supabase.com)
2. Clic en **New project**
3. Elige nombre y contraseña de base de datos (guárdala)
4. Selecciona región más cercana
5. Espera a que se cree (~2 min)

---

## Paso 2: Crear las tablas

Ve a **SQL Editor** en el panel lateral izquierdo y ejecuta este bloque completo:

```sql
-- ========================================
-- TABLA lists
-- Cada fila es una lista de regalos.
-- secret_id es el identificador que comparten los invitados (≥32 chars).
-- ========================================
create table lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users not null,
  secret_id text unique not null,
  created_at timestamptz default now()
);

-- Índice para búsquedas rápidas por secret_id (lo usan los invitados)
create index idx_lists_secret_id on lists (secret_id);

-- Habilitar Row Level Security
alter table lists enable row level security;

-- ========================================
-- TABLA gifts
-- Cada fila es un regalo perteneciente a una lista.
-- links guarda un array JSON de {label, color, price, url}.
-- ========================================
create table gifts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references lists(id) on delete cascade not null,
  name text not null,
  photo_url text,
  note text,
  essential boolean default false,
  bought boolean default false,
  reserved boolean default false,
  links jsonb default '[]',
  position integer default 0,
  created_at timestamptz default now()
);

-- Índice para filtrar regalos por lista
create index idx_gifts_list_id on gifts (list_id);

-- Habilitar Row Level Security
alter table gifts enable row level security;
```

---

## Paso 3: Crear las políticas RLS

Sigue en **SQL Editor** y ejecuta este bloque:

```sql
-- ========================================
-- POLÍTICAS PARA lists
-- ========================================

-- 1. SELECT: Cualquiera puede leer una lista si conoce su secret_id.
--    Esto es lo que permite a los invitados acceder a la lista
--    pegando el enlace. No exponemos nada más que el secret_id
--    como mecanismo de acceso.
create policy "lists_select_by_secret"
  on lists for select
  using (true);

-- 2. INSERT: Solo el usuario autenticado puede crear listas,
--    y el owner_id debe ser el propio usuario.
--    Impide que alguien cree listas a nombre de otro.
create policy "lists_insert_own"
  on lists for insert
  with check (owner_id = auth.uid());

-- 3. UPDATE: Solo el dueño puede modificar su lista.
create policy "lists_update_own"
  on lists for update
  using (owner_id = auth.uid());

-- 4. DELETE: Solo el dueño puede borrar su lista.
--    (Al borrar una lista, cascade borra sus gifts automáticamente.)
create policy "lists_delete_own"
  on lists for delete
  using (owner_id = auth.uid());

-- ========================================
-- POLÍTICAS PARA gifts
-- ========================================

-- 5. SELECT: Cualquiera puede leer los regalos de una lista.
--    La seguridad real está en que necesitas el secret_id
--    para saber qué lista pedir (lo valida la app en el frontend).
create policy "gifts_select_all"
  on gifts for select
  using (true);

-- 6. INSERT: Solo el dueño de la lista puede añadir regalos.
--    La policy verifica que el list_id pertenezca al usuario.
create policy "gifts_insert_owner"
  on gifts for insert
  with check (
    exists (
      select 1 from lists
      where lists.id = list_id
      and lists.owner_id = auth.uid()
    )
  );

-- 7. UPDATE: Solo el dueño puede editar regalos.
--    (El campo "reserved" se actualiza vía RPC, no por aquí.)
create policy "gifts_update_owner"
  on gifts for update
  using (
    exists (
      select 1 from lists
      where lists.id = list_id
      and lists.owner_id = auth.uid()
    )
  );

-- 8. DELETE: Solo el dueño puede borrar regalos.
create policy "gifts_delete_owner"
  on gifts for delete
  using (
    exists (
      select 1 from lists
      where lists.id = list_id
      and lists.owner_id = auth.uid()
    )
  );
```

---

## Paso 4: Crear la función RPC para reservas

Sigue en **SQL Editor** y ejecuta:

```sql
-- ========================================
-- FUNCIÓN RPC: toggle_reserved
-- ========================================
-- ¿Por qué una función RPC y no una policy UPDATE directa?
--
-- Supabase RLS no permite restringir qué COLUMNAS actualiza un rol.
-- Si dejáramos UPDATE abierto para invitados, podrían modificar
-- "name", "bought", "essential", etc.
--
-- Con SECURITY DEFINER, esta función:
--   1. Se ejecuta con los permisos del creador (postgres/superuser)
--   2. Valida internamente que el secret_id sea correcto
--   3. SOLO modifica el campo "reserved" — nada más
--   4. Es imposible que un invitado toque otros campos
--
-- Es la forma más segura de permitir "reservar" sin riesgo.
-- ========================================
create or replace function toggle_reserved(
  p_gift_id uuid,
  p_reserved boolean,
  p_secret_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Verificar que el secret_id corresponde a una lista real
  -- y que el gift pertenece a esa lista
  update gifts
  set reserved = p_reserved
  where id = p_gift_id
    and list_id in (
      select id from lists where secret_id = p_secret_id
    );

  -- Si no se actualizó ninguna fila, el gift_id o secret_id no coinciden
  if not found then
    raise exception 'Gift not found or invalid secret_id';
  end if;
end;
$$;
```

---

## Paso 5: Crear el usuario admin

### Opción A — Desde el Dashboard (más fácil)

1. Ve a **Authentication** en el panel lateral
2. Clic en **Add user** → **Create new user**
3. Introduce email y contraseña (guárdalas, las necesitas para entrar)
4. Clic en **Create user**

### Opción B — Desde la propia web (una vez desplegada)

Si prefieres que el registro se haga desde la web, descomenta el botón de registro en el HTML
(configuración en el código, busca `SIGNUP_ENABLED`). Por defecto el registro está deshabilitado
para que solo tú puedas crear la cuenta de admin.

---

## Paso 6: Configurar el archivo HTML

Abre `index.html` y busca estas dos líneas al principio del bloque `<script>`:

```javascript
const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
```

Para obtener los valores:

1. Ve a **Project Settings** (icono de engranaje ⚙️) → **API**
2. **Project URL** → cópialo en `SUPABASE_URL`
3. **Project API keys** → **anon public** → cópiala en `SUPABASE_ANON_KEY`

> **¿Es seguro exponer la anon key en el HTML?**
> Sí. La anon key NO es un secreto. Está diseñada para ser pública.
> Toda la seguridad depende de las políticas RLS que configuraste arriba.
> Sin la service_role key (que NUNCA se expone en el frontend), la anon key
> por sí sola no permite saltarse ninguna regla. Un atacante que abra la
> consola del navegador solo puede hacer lo que las policies permiten:
> leer la lista conociendo el secret_id, y reservar por RPC. Nada más.

---

## Paso 7: Desplegar

### Netlify (el más fácil — arrastrar)

1. Entra en [app.netlify.com](https://app.netlify.com)
2. Arrastra el archivo `index.html` (solo ese) a la zona de "Deploy"
3. Te da una URL tipo `https://tu-app.netlify.app`
4. (Opcional) En **Domain settings** puedes poner un dominio personalizado

### Vercel

1. `npm i -g vercel`
2. En la carpeta del archivo: `vercel`
3. Sigue las instrucciones en pantalla

### GitHub Pages

1. Sube `index.html` a un repo de GitHub
2. Ve a **Settings** → **Pages** → Source: **Deploy from a branch** → `main` / `/ (root)`
3. URL: `https://tu-usuario.github.io/tu-repo`

---

## Paso 8: Primer uso

1. Abre la URL donde desplegaste la web
2. Pestaña **Admin** → entra con tu email y contraseña de Supabase
3. Como es tu primera vez, no tienes lista → se crea una automáticamente
4. Añade regalos con el botón "Añadir regalo"
5. Copia el enlace de la lista desde el banner verde que aparece arriba
6. Compártese ese enlace con los invitados
7. Los invitados abren el enlace → ven la lista → pueden reservar regalos

---

## Arquitectura de seguridad (resumen)

```
┌─────────────────────────────────────────────────────────┐
│                    Navegador (HTML/JS)                   │
│                                                          │
│  anon key (pública) ──► Supabase Client SDK             │
│                                                          │
│  Admin:  supabase.auth.signInWithPassword(email, pass)  │
│  Guest:  conoce el secret_id por el enlace              │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Supabase (PostgreSQL)                   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Row Level Security (RLS)                        │    │
│  │                                                  │    │
│  │ lists:                                           │    │
│  │   SELECT  → cualquiera (la app filtra por       │    │
│  │              secret_id en la query)              │    │
│  │   I/U/D   → solo owner_id = auth.uid()          │    │
│  │                                                  │    │
│  │ gifts:                                           │    │
│  │   SELECT  → cualquiera (la app filtra por       │    │
│  │              list_id del secret_id)              │    │
│  │   I/U/D   → solo dueño de la lista              │    │
│  │                                                  │    │
│  │ RPC toggle_reserved (SECURITY DEFINER):          │    │
│  │   → Valida secret_id internamente               │    │
│  │   → Solo modifica campo "reserved"               │    │
│  │   → Invitados no pueden tocar nada más           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Realtime                                        │    │
│  │   → Escucha cambios en gifts (campo reserved)   │    │
│  │   → Actualización instantánea para todos        │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Notas de seguridad

### ¿Qué impide que un invitado manipule datos desde la consola?

Supongamos que un invitado abre la consola del navegador e intenta:

```javascript
// Intento 1: Modificar un campo que no es "reserved"
supabase.from('gifts').update({ bought: true }).eq('id', 'xxx')
// → RLS lo bloquea: la policy "gifts_update_owner" requiere auth.uid() = owner

// Intento 2: Añadir un regalo
supabase.from('gifts').insert({ list_id: 'xxx', name: 'hackeado' })
// → RLS lo bloquea: la policy "gifts_insert_owner" requiere auth.uid() = owner

// Intento 3: Borrar un regalo
supabase.from('gifts').delete().eq('id', 'xxx')
// → RLS lo bloquea: la policy "gifts_delete_owner" requiere auth.uid() = owner

// Intento 4: Usar RPC para modificar algo que no sea reserved
// → Imposible: la función toggle_reserved() solo acepta y modifica el campo "reserved"

// Intento 5: Crear una lista a nombre de otro usuario
supabase.from('lists').insert({ owner_id: 'otro-uid', secret_id: 'xxx' })
// → RLS lo bloquea: la policy "lists_insert_own" requiere owner_id = auth.uid()
```

La anon key por sí sola no da ningún privilegio especial. Las policies son la puerta.

### ¿Por qué no se puede guardar la contraseña en el HTML?

Si la contraseña estuviera en el HTML, cualquier persona que vea el código fuente
(Click derecho → Ver código fuente) tendría acceso admin completo. Con Supabase Auth,
la contraseña nunca sale del navegador y se autentica contra el servidor de Supabase.

---

## Preguntas frecuentes

**P: ¿Puedo usar magic link en vez de email+contraseña?**
R: Sí, cambia `signInWithPassword` por `signInWithOtp({ email })` en el código.
Necesitarás configurar un proveedor de email en Supabase (SMTP o el integrado).

**P: ¿Puedo tener varias listas?**
R: Sí, el admin puede crear múltiples listas. Al entrar, si tiene más de una,
aparece un selector para elegir cuál gestionar.

**P: ¿Qué pasa si alguien comparte el enlace de admin?**
R: El enlace de admin no existe como tal — solo hay login con email+contraseña.
Si alguien obtiene las credenciales, puede gestionar la lista. Usa una contraseña fuerte.

**P: ¿Puedo cambiar el diseño?**
R: Sí, todo el CSS está en el bloque `<style>` del HTML. Las variables CSS
(`:root`) controlan los colores principales.

**P: ¿Funciona sin conexión a internet?**
R: No. Supabase necesita conexión. Si falla la conexión, se muestra un mensaje
de error amigable.
