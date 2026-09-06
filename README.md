# Health OS backend

Backend para receber dados de diferentes fontes de saúde, preservar o payload original e convertê-lo para um modelo comum.

## Primeira entrega

- API TypeScript com Fastify
- PostgreSQL/Supabase
- webhook Garmin com validação opcional de segredo
- processamento idempotente de eventos
- métricas normalizadas para sono, recuperação e atividades
- estrutura extensível para Strava, Apple Health e importações manuais

## Executar localmente

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm run dev
```

A API ficará disponível em `http://localhost:3000`. Verifique com `curl http://localhost:3000/health`.

## Endpoints

| Método | Caminho | Uso |
|---|---|---|
| `GET` | `/health` | Estado da aplicação e do banco |
| `POST` | `/v1/integrations/garmin/webhooks` | Recebe notificações Garmin |
| `POST` | `/v1/integrations/:provider/sync` | Registra solicitação de sincronização |
| `GET` | `/v1/metrics?from=&to=&type=` | Lista métricas normalizadas |

Se `GARMIN_WEBHOOK_SECRET` estiver definido, envie o mesmo valor no header `x-webhook-secret`.

## Banco

Rode `db/migrations/001_initial.sql` no SQL Editor do Supabase ou use `npm run db:migrate` com `DATABASE_URL` configurada.

## Garmin

O backend está preparado para notificações da Garmin Health API. As credenciais são liberadas após cadastro e aprovação do aplicativo. Até lá, use `fixtures/garmin-webhook.json` para testes locais.

## Segurança

- Nunca versionar `.env` ou credenciais.
- `raw_events` guarda o payload original para reprocessamento e auditoria.
- Dados médicos devem permanecer privados; RLS já é habilitada pela migração inicial.
