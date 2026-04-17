# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Leia `SPEC.md` para a especificação completa e `README.md` para o fluxo de uso.

## Visão geral
**Neo-Label** — aplicação web para anotação de dados para datasets de ML. Foco
atual: **pose detection** (17 keypoints COCO) com upload de vídeos + extração
de frames via FFmpeg. Em roadmap: image segmentation, NER, bounding boxes,
classificação.

Monorepo com dois apps independentes:
- `backend/` — API Python (FastAPI + Pydantic v2, persistência em JSON no filesystem)
- `frontend/` — SPA TypeScript (Vite + React 18 + Tailwind + TanStack Query + Zustand)

## Stack

### Backend
- Python 3.12, FastAPI, Pydantic v2
- **Persistência: filesystem (JSON files)** — **sem banco de dados**.
  Toda leitura/escrita passa por `app/core/storage.py` (I/O atômico).
- Auth: JWT (python-jose) + `bcrypt` direto (sem passlib — quebra com bcrypt 4.x)
- Config: pydantic-settings (`app/core/config.py`, lê `.env`). `DATA_DIR` controla onde os dados vão.
- FFmpeg (binário externo) para extrair frames de vídeos enviados.
- Estrutura: `api/v1/` (routers) → `services/` (lógica) → `schemas/` (Pydantic) → `core/storage.py` (I/O)
- Dep injetada via `app/core/deps.py`: `CurrentUser` (e helpers de papel, ex. admin)

### Frontend
- React 18 + TypeScript, Vite, Tailwind CSS
- TanStack Query (data fetching/cache), Zustand + persist (auth store)
- React Router v6, React Hook Form + Zod
- Cliente HTTP: axios com interceptor de Bearer em `src/api/client.ts` (401 → logout automático)
- Alias `@/` → `src/`

## Ambiente uv (compartilhado)
- venv: `/mnt/hd3/uv-common/uv-neo-label` (Python 3.12)
- cache: `/mnt/hd3/uv-cache`

```bash
export UV_CACHE_DIR=/mnt/hd3/uv-cache
source /mnt/hd3/uv-common/uv-neo-label/bin/activate
```

Instalar/atualizar deps do backend:
```bash
cd backend
VIRTUAL_ENV=/mnt/hd3/uv-common/uv-neo-label UV_CACHE_DIR=/mnt/hd3/uv-cache uv pip install -e ".[dev]"
```

## Como rodar

Setup inicial (uma vez):
```bash
cp .env.example .env
cp seed_users.example.json seed_users.json   # edite com as credenciais desejadas
```

`seed_users.json` é lido na primeira inicialização do backend; cada usuário é
criado se não existir (não sobrescreve senhas). Papéis aceitos:
`admin`, `annotator`, `reviewer`.

Três formas de subir:
```bash
# 1. Menu interativo (start/stop/logs dos dois apps)
python run.py

# 2. Manual
cd backend && uvicorn app.main:app --reload    # http://localhost:8000/docs
cd frontend && npm install && npm run dev      # http://localhost:5173

# 3. Docker
docker compose up
```

Dados são criados automaticamente em `DATA_DIR` (default `./data`) na primeira escrita.

## Build, lint, testes

```bash
# Backend — testes (pytest, modo async automático)
cd backend && pytest                              # toda a suíte
pytest tests/test_auth_api.py                     # um arquivo
pytest tests/test_auth_api.py::test_login_ok      # um teste
pytest -k keypoint                                # por nome

# Backend — lint/format (ruff configurado em pyproject.toml, line-length=100)
ruff check backend
ruff format backend

# Frontend
cd frontend && npm run lint                       # eslint (.ts/.tsx)
npm run build                                     # tsc -b + vite build
npm run preview                                   # serve build local
```

Cada teste isola `DATA_DIR` via fixture `_isolated_data_dir` (autouse) em
`tests/conftest.py` — nenhum teste toca no `./data` local. Fixtures úteis:
`client`, `auth_headers`, `second_user_headers`, `admin_headers`.

## Layout

```
backend/app/
  api/v1/                 # routers: auth, users, projects, labels, items, videos
                          # api_router montado em api/v1/__init__.py
  core/
    config.py             # pydantic-settings (DATA_DIR, SECRET_KEY, FRONTEND_URL, ...)
    security.py           # bcrypt + JWT
    storage.py            # único ponto de persistência: I/O atômico em JSON sob DATA_DIR
    deps.py               # CurrentUser e gates por papel
  schemas/                # Pydantic v2 + enums (UserRole, ProjectType, ItemStatus, ...)
  services/               # lógica de negócio (síncronas — chamam storage)
  main.py                 # FastAPI app + CORS + include api_router + seed de usuários
backend/tests/            # pytest + httpx TestClient; conftest.py isola DATA_DIR

data/                     # criada em runtime
  users.json
  _counters.json
  projects/<id>/
    project.json
    items/<id>.json
    annotations/<item_id>__<user_id>.json
    videos/                # uploads
    frames/                # extraídos via FFmpeg

frontend/src/
  api/                    # cliente axios + módulos por recurso (auth, projects, ...)
  pages/                  # rotas: Login, Projects, ProjectDetail, Annotate (texto/pose)
  features/auth, projects # componentes por domínio
  components/             # BabyAvatar (guia do anotador de pose) + ui/
  stores/                 # zustand (auth)
  lib/                    # utils (env)
  App.tsx                 # rotas; main.tsx = providers (QueryClient, Router)
```

## Convenções

### Código
- **Spec-driven**: `SPEC.md` é fonte de verdade. Se a realidade divergir,
  atualize a spec **antes** do código.
- Backend: services retornam models/dicts; routers fazem `Schema.model_validate(...)`.
  Toda rota autenticada usa `CurrentUser` dep (nunca ler token manualmente).
- Schemas Pydantic: `ConfigDict(from_attributes=True)` nos `*Read`.
- Operações destrutivas em lote (deletar projeto, limpar anotações em massa)
  exigem papel `admin` — usar os gates em `deps.py`.
- Rotas protegidas retornam 404 (não 403) quando o recurso não pertence ao usuário,
  para não vazar existência — **exceção atual**: `projects.py` retorna 403.
  (TODO: padronizar para 404.)
- Frontend: nunca setar `Authorization` manualmente — o interceptor cuida.
  401 → `useAuth.logout()` automático.
- Tailwind utility-first; sem CSS custom salvo em `index.css`.

### Evoluindo o schema de dados
Como é filesystem, não há migrações. Ao mudar a forma de um registro:
- Escreva código de leitura tolerante (`dict.get(...)` com defaults) — arquivos antigos continuam lá.
- Para mudanças incompatíveis, script ad-hoc em `backend/scripts/` que percorre
  `DATA_DIR` e reescreve os JSONs.
- Registre a mudança em `SPEC.md`.

## Roadmap (resumido — detalhes em `SPEC.md`)
- ✅ Fase 1: auth + projects CRUD + UI de login/registro/projetos
- ✅ Fase 2 (backend): labels, items bulk upload, annotations, export (json/jsonl/csv)
- ✅ Pose detection: 17 keypoints COCO, avatar-guia, upload de vídeo, extração de frames
- ✅ Admin role, seed users, export YOLO, gerência de items, suíte de testes no backend
- ⏳ Image segmentation, revisão + Cohen's kappa, imagens (bbox/COCO), NER

## Cuidados
- Não commitar `.env`, `seed_users.json` nem a pasta `data/` (já em `.gitignore`).
- `SECRET_KEY` do `.env.example` é só para dev.
- CORS está travado em `FRONTEND_URL` — revisar antes de expor.
- Senhas nunca logadas; bcrypt é one-way.
- Storage é single-process. Múltiplos workers exigem file locks ou voltar para DB.
- FFmpeg precisa estar no PATH para o upload de vídeo funcionar.
