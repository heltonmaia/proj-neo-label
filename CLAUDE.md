# CLAUDE.md

Guia de contexto para assistentes AI (Claude Code) trabalhando neste repositório.
Leia `SPEC.md` para a especificação completa e roadmap por fases.

## Visão geral
**Neo-Label** — aplicação web para anotação de dados (rotulagem) para datasets
de Machine Learning. Suporta (roadmap) classificação de texto/imagem, NER e
bounding boxes.

Monorepo com dois apps independentes:
- `backend/` — API Python (FastAPI async + SQLAlchemy 2 + PostgreSQL)
- `frontend/` — SPA TypeScript (Vite + React 18 + Tailwind + React Query + Zustand)

## Stack

### Backend
- Python 3.12, FastAPI
- **Persistência: filesystem (JSON files)** — sem banco de dados.
  Toda leitura/escrita passa por `app/core/storage.py`.
- Auth: JWT (python-jose) + `bcrypt` (direto, sem passlib — passlib quebra com bcrypt 4.x)
- Config: pydantic-settings (`app/core/config.py`, lê `.env`). `DATA_DIR` controla onde os dados vão.
- Estrutura: `api/` (routers) → `services/` (lógica) → `schemas/` (Pydantic) → `storage` (I/O)
- Dep injetada via `app/core/deps.py`: `CurrentUser`

### Frontend
- React 18 + TypeScript, Vite, Tailwind CSS
- React Query (data fetching/cache), Zustand + persist (auth store)
- React Router v6, React Hook Form + Zod
- Cliente HTTP: axios com interceptor de Bearer em `src/api/client.ts`
- Alias `@/` → `src/`

## Ambiente uv (compartilhado)
- venv: `/mnt/hd3/uv-common/uv-neo-label` (Python 3.12)
- cache: `/mnt/hd3/uv-cache`

```bash
export UV_CACHE_DIR=/mnt/hd3/uv-cache
source /mnt/hd3/uv-common/uv-neo-label/bin/activate
```

Para instalar novas deps do backend:
```bash
cd backend
VIRTUAL_ENV=/mnt/hd3/uv-common/uv-neo-label UV_CACHE_DIR=/mnt/hd3/uv-cache uv pip install -e .
```

## Como rodar
```bash
cp .env.example .env
# backend
cd backend && uvicorn app.main:app --reload
# frontend
cd frontend && npm install && npm run dev
```
Dados são criados automaticamente em `DATA_DIR` (default `./data`) na primeira escrita.
- API: http://localhost:8000/docs
- UI:  http://localhost:5173

Alternativa: `docker compose up` sobe db + backend + frontend.

## Layout

```
backend/app/
  api/v1/       # routers agrupados; api_router em api/v1/__init__.py
  core/
    config.py   # pydantic-settings (DATA_DIR, SECRET_KEY, ...)
    security.py # bcrypt + JWT
    storage.py  # I/O atômico em JSON sob DATA_DIR (único ponto de persistência)
    deps.py     # CurrentUser
  schemas/      # Pydantic v2 + enums (UserRole, ProjectType, ItemStatus)
  services/     # lógica de negócio (síncronas — chamam storage)
  main.py       # FastAPI app + CORS + include api_router

data/           # criada em runtime — cada projeto vira uma subpasta
  users.json
  _counters.json
  projects/<id>/
    project.json
    items/<id>.json
    annotations/<item_id>__<user_id>.json

frontend/src/
  api/          # cliente axios + módulos por recurso (auth, projects, ...)
  pages/        # páginas roteadas
  features/     # componentes por domínio (quando crescer)
  stores/       # zustand (auth)
  lib/          # utils (env)
  App.tsx       # rotas; main.tsx = providers (QueryClient, Router)
```

## Convenções

### Código
- **Spec-driven**: `SPEC.md` é fonte de verdade. Se a realidade divergir,
  atualize a spec **antes** do código.
- Backend: services retornam models; routers fazem `Schema.model_validate(...)`.
  Toda rota autenticada usa `CurrentUser` dep (não ler token manualmente).
- Schemas Pydantic: `ConfigDict(from_attributes=True)` nos `*Read`.
- Rotas protegidas retornam 404 (não 403) quando o recurso não pertence ao usuário,
  para não vazar existência — **exceção atual**: `projects.py` retorna 403.
  (TODO: padronizar para 404.)
- Frontend: nunca colocar `Authorization` manualmente — o interceptor cuida.
  401 → `useAuth.logout()` (automático).
- Tailwind utility-first; sem CSS custom salvo em `index.css`.

### Evoluindo o schema de dados
Como é filesystem, não há migrações. Ao mudar a forma de um registro:
- Escreva código de leitura tolerante (`dict.get(...)` com defaults) — arquivos antigos continuam lá.
- Para mudanças incompatíveis, escreva um script ad-hoc em `backend/scripts/` que
  percorre `DATA_DIR` e reescreve os JSONs.
- Registre a mudança em `SPEC.md`.

### Testes
- Backend: pytest + httpx (ainda não implementado — TODO Fase 3)
- Frontend: vitest + RTL (ainda não implementado)

## Roadmap (resumido — detalhes em `SPEC.md`)
- ✅ **Fase 1**: auth + projects CRUD + UI de login/registro/projetos
- ✅ **Fase 2 (backend)**: labels, items bulk upload, annotations, export (json/jsonl/csv)
- ⏳ **Fase 2 (frontend)**: ProjectDetailPage, AnnotatePage, export UI
- **Fase 3**: roles, assignment, review, Cohen's kappa
- **Fase 4**: imagens (upload, classificação, bbox, COCO)
- **Fase 5**: NER (token/span)

## Cuidados
- Não commitar `.env` nem a pasta `data/` (já em `.gitignore`).
- `SECRET_KEY` do `.env.example` é só para dev.
- CORS está travado em `FRONTEND_URL` — mudar antes de expor.
- Senhas nunca logadas; bcrypt é one-way.
- Storage é single-process. Se rodar múltiplos workers, precisa de file locks ou voltar para DB.
