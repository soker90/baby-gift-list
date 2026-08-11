# Configuración de Supabase

## Paso 1: Crear el proyecto

1. Entra en [app.supabase.com](https://app.supabase.com)
2. Clic en **New project**
3. Elige nombre y contraseña de base de datos (guárdala)
4. Selecciona la región más cercana
5. Espera a que se cree (~2 min)

---

## Paso 2: Crear las tablas

Ve a **SQL Editor** en el panel lateral y ejecuta:

```sql
create table lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users not null,
  secret_id text unique not null,
  created_at timestamptz default now()
);

create index idx_lists_secret_id on lists (secret_id);
alter table lists enable row level security;

create table gifts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references lists(id) on delete cascade not null,
  name text not null,
  photo_url text,
  note text,
  essential boolean default false,
  bought boolean default false,
  reserved boolean default false,
  reserved_by text,
  links jsonb default '[]',
  position integer default 0,
  created_at timestamptz default now()
);

create index idx_gifts_list_id on gifts (list_id);
alter table gifts enable row level security;
```

---

## Paso 3: Crear las políticas RLS

```sql
-- lists: cualquiera puede leer (la app filtra por secret_id)
create policy "lists_select_by_secret"
  on lists for select using (true);

-- lists: solo el dueño puede crear, editar y borrar
create policy "lists_insert_own"
  on lists for insert with check (owner_id = auth.uid());

create policy "lists_update_own"
  on lists for update using (owner_id = auth.uid());

create policy "lists_delete_own"
  on lists for delete using (owner_id = auth.uid());

-- gifts: cualquiera puede leer (la app filtra por list_id)
create policy "gifts_select_all"
  on gifts for select using (true);

-- gifts: solo el dueño de la lista puede crear, editar y borrar
create policy "gifts_insert_owner"
  on gifts for insert
  with check (
    exists (
      select 1 from lists
      where lists.id = list_id and lists.owner_id = auth.uid()
    )
  );

create policy "gifts_update_owner"
  on gifts for update
  using (
    exists (
      select 1 from lists
      where lists.id = list_id and lists.owner_id = auth.uid()
    )
  );

create policy "gifts_delete_owner"
  on gifts for delete
  using (
    exists (
      select 1 from lists
      where lists.id = list_id and lists.owner_id = auth.uid()
    )
  );
```

---

## Paso 4: Crear la función RPC para reservas

Los invitados reservan regalos a través de esta función en lugar de un UPDATE directo. Al usar `SECURITY DEFINER` y validar el `secret_id` internamente, se garantiza que solo se modifican los campos `reserved` y `reserved_by` — ningún otro campo.

Al reservar (`p_reserved = true`) se exige un nombre de al menos 3 caracteres (tras quitar espacios). Al cancelar (`p_reserved = false`) se limpia `reserved_by`, independientemente de quién la cancele.

```sql
create or replace function toggle_reserved(
  p_gift_id uuid,
  p_reserved boolean,
  p_secret_id text,
  p_reserved_by text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reserved and length(trim(coalesce(p_reserved_by, ''))) < 3 then
    raise exception 'reserved_by must be at least 3 characters';
  end if;

  update gifts
  set
    reserved = p_reserved,
    reserved_by = case when p_reserved then trim(p_reserved_by) else null end
  where id = p_gift_id
    and list_id in (
      select id from lists where secret_id = p_secret_id
    );

  if not found then
    raise exception 'Gift not found or invalid secret_id';
  end if;
end;
$$;
```

> **Migración de una instalación existente**: si ya tenías la tabla `gifts` creada, ejecuta primero:
> ```sql
> alter table gifts add column if not exists reserved_by text;
> ```
> y después vuelve a ejecutar el `create or replace function toggle_reserved` de arriba para sustituir la versión anterior.

---

## Paso 5: Notificaciones por email (Resend)

Cada vez que se reserva o cancela un regalo, el frontend llama a una Netlify Function (`netlify/functions/notify-reservation.js`) que envía un email a `reservas@unregaloparabea.es` usando [Resend](https://resend.com).

1. En el panel de Netlify del sitio, ve a **Site configuration → Environment variables**.
2. Añade la variable `RESEND_API_KEY` con tu API key de Resend (dominio `unregaloparabea.es` ya verificado).
3. Vuelve a desplegar el sitio para que la función recoja la variable.

No hace falta ninguna configuración adicional en Supabase para esto: el email se dispara desde el navegador del invitado hacia la función de Netlify justo después de que el RPC `toggle_reserved` se complete con éxito.

---

## Paso 6: Crear el usuario admin

1. Ve a **Authentication** en el panel lateral
2. Clic en **Add user** → **Create new user**
3. Introduce email y contraseña
4. Clic en **Create user**

---

## Paso 7: Obtener las claves y pegarlas en el HTML

1. Ve a **Project Settings** → **API**
2. Copia **Project URL** → pégala en `SUPABASE_URL`
3. Copia **anon public** (o **publishable**) → pégala en `SUPABASE_ANON_KEY`

Estas dos constantes están al principio del bloque `<script>` en `index.html`.

> La anon key es pública y está diseñada para exponerse en el frontend. Toda la seguridad recae en las políticas RLS, no en ocultar esta clave.
