# Health OS backend

Backend para consolidar dados de saúde, preservar a origem de cada informação e convertê-la para um modelo comum que possa alimentar o Health OS e análises com IA.

## V1

- API TypeScript com Fastify
- PostgreSQL/Supabase
- Garmin Health API preparada para webhook oficial
- importação em lote de amostras do Apple Health
- armazenamento idempotente do payload bruto
- métricas normalizadas com proveniência: `measured`, `estimated`, `self_reported` e `inferred`
- hidratação em um toque
- check-ins de energia, concentração, stress, fome, fadiga e bem-estar
- contexto de trabalho
- schema para refeições e exames clínicos
- estrutura extensível para Strava e outras fontes

## Arquitetura de integração

A prioridade de origem planejada é:

1. Garmin para treino e métricas Garmin disponíveis
2. Apple Health como ponte para dados acessíveis via HealthKit
3. Strava para complementar atividades
4. registro manual para alimentação, água, contexto e percepção

O endpoint Apple Health não acessa o HealthKit diretamente. Um app/bridge iOS autorizado pelo usuário lê o HealthKit e envia lotes para `POST /v1/integrations/apple-health/import`.

## Executar localmente

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm test
npm run dev
```

A API ficará disponível em `http://localhost:3000`.

## Endpoints

| Método | Caminho | Uso |
|---|---|---|
| `GET` | `/health` | Estado da aplicação e do banco |
| `POST` | `/v1/integrations/garmin/webhooks` | Recebe notificações Garmin |
| `POST` | `/v1/integrations/apple-health/import` | Recebe amostras lidas pelo bridge iOS |
| `POST` | `/v1/integrations/:provider/sync` | Registra solicitação de sincronização |
| `GET` | `/v1/metrics?from=&to=&type=` | Lista métricas normalizadas |
| `POST` | `/v1/hydration` | Registra água |
| `POST` | `/v1/checkins` | Registra estado percebido |
| `PUT` | `/v1/work-context/:date` | Cria/atualiza contexto de trabalho |

## Banco

As migrations ficam em `db/migrations`. Rode `npm run db:migrate` com `DATABASE_URL` configurada ou execute os arquivos no SQL Editor do Supabase.

## Garmin

O backend aceita o formato de notificações da Garmin Health API. Credenciais oficiais ainda dependem do Garmin Connect Developer Program. Até lá, Apple Health pode ser usado como ponte para as categorias que o Garmin efetivamente sincronizar ao HealthKit.

## Próximos passos

1. conectar o projeto Supabase
2. criar autenticação e políticas RLS por usuário
3. construir o bridge iOS/HealthKit
4. mapear, no aparelho real, quais categorias do Garmin chegam ao Apple Health
5. implementar upload seguro de fotos de refeições e documentos clínicos
6. criar a API agregada da tela Hoje

## Segurança

- Nunca versionar `.env`, tokens ou credenciais.
- `raw_events` preserva o payload original para auditoria/reprocessamento.
- RLS está habilitada nas tabelas de saúde.
- Antes de expor a API na internet, autenticação por usuário e políticas RLS precisam estar concluídas.
