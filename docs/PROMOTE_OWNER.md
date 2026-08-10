# Promover um usuário a `owner`

Não existe (e não deve existir) nenhuma rota ou botão no painel para auto-promoção de papel —
isso é intencional. O primeiro `owner` de cada ambiente (staging, produção) é criado manualmente
pelo dashboard do Supabase, nunca por um agente ou script com acesso à `SUPABASE_SERVICE_ROLE_KEY`
colada em um chat ou repositório.

## 1. Criar o usuário no Supabase Auth

- Acesse o projeto (ex.: `caseirinhas-engine-staging`) em [dashboard.supabase.com](https://dashboard.supabase.com)
- **Authentication → Users → Add user**
- Use um email real e uma senha forte, ou "Send invite email" para o usuário definir a própria senha

Ao fazer isso, o trigger `on_auth_user_created` (ver `supabase/migrations/20260809120000_staff_rbac_and_campaign_policies.sql`)
cria automaticamente uma linha em `public.profiles` com `role = 'viewer'`.

## 2. Promover esse usuário a `owner`

No **SQL Editor** do Supabase, rode substituindo o email:

```sql
update public.profiles
set role = 'owner'
where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

## 3. Confirmar

```sql
select u.email, p.role
from public.profiles p
join auth.users u on u.id = p.id
order by u.email;
```

## 4. Testar

Faça login em `/login` com esse email/senha. O cabeçalho do painel deve mostrar o papel `OWNER`
ao lado do email — só então os botões de iniciar/pausar/cancelar campanha ficam visíveis
(`src/app/painel/campanhas/[id]/page.tsx` esconde essas ações para quem não é `owner`).

## Rebaixar ou revogar acesso

Mesmo padrão, apontando para outro papel:

```sql
update public.profiles set role = 'operator' where id = (select id from auth.users where email = '...');
```

Para remover o acesso por completo, delete o usuário em **Authentication → Users** — o `profiles.id`
tem `references auth.users(id) on delete cascade`, então a linha de perfil é removida junto.
