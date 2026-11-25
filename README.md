# Átrio — Leilão Online Distribuído

Projeto acadêmico de Sistemas Distribuídos, com frontend React + Tailwind CSS e backend Node.js. Mantém a eleição Bully, relógio lógico de Lamport, replicação, quórum de escrita e gerenciamento de até cinco nós do projeto original.

Base: [Leilao-Distribuido](https://github.com/Felipe-Meneguzz1/Leilao-Distribuido), commit `f669a94edbaa620d51654702ee6aa72a05091cd2`. A lógica distribuída foi preservada; os nós agora exigem o token interno compartilhado e o gateway autentica e autoriza as operações.

## Perfis de acesso

- **Administrador/criador**: mantém o painel original completo (visão geral, leilões, laboratório, eventos, simulação, gerenciamento dos nós e quórum).
- **Cliente**: cadastra-se, entra, consulta os leilões e o histórico, e registra lances em seu próprio nome. Não pode criar/encerrar leilões, simular lances nem administrar a infraestrutura.
- O administrador inicial é criado automaticamente a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD` no primeiro início do gateway. O cadastro público sempre cria clientes. A aplicação usa um administrador global, não permissões individuais por leilão.

### Autenticação e persistência

O gateway usa o módulo nativo `node:sqlite` do Node.js 22.13+ (sem bibliotecas externas de SQLite). O banco `auth.sqlite` contém as tabelas `users` e `sessions`. As senhas são armazenadas com scrypt e salt aleatório. As sessões expiram em 8 horas, usam tokens aleatórios (somente o hash fica no banco) e cookies HttpOnly/SameSite=Strict. O logout revoga a sessão. O gateway verifica as permissões no servidor; esconder botões na interface não é a única proteção.

No Docker o banco fica em `/data/auth.sqlite`, no volume `dashboard_data`. Os leilões, lances, configuração e logs do protocolo continuam nos volumes originais dos nós. SQLite não substitui a replicação de leilões e não é replicado entre os nós. O gateway continua sendo um ponto central de autenticação e gerenciamento.

## Executar no Windows com Docker Desktop

1. Abra o Docker Desktop (engine Linux).
2. Extraia o ZIP e abra um terminal PowerShell na pasta `Leilao-Distribuido`.
3. Copie o arquivo de configuração e edite os valores (escolha senha forte e token aleatório; não mantenha os exemplos):

```powershell
Copy-Item .env.example .env
notepad .env
```

4. Execute:

```powershell
docker compose up --build -d
docker compose ps
```

5. Acesse http://localhost:8080 e entre com o e-mail e senha definidos no `.env`. Abra outra janela anônima e cadastre uma conta de cliente para testar os dois perfis.

O Docker instala as dependências e compila o frontend automaticamente. O gateway entrega a interface React e as rotas `/api` na mesma origem. Não é necessário instalar Node.js localmente para rodar via Docker.

São seis contêineres: `node1` a `node5` e `dashboard`. Inicialmente os nós 1, 2 e 3 participam do cluster; 4 e 5 são reservas. O líder inicial esperado é o Nó 3. Os nomes dos serviços, do projeto Compose (`atrio-leilao`) e dos volumes foram mantidos para reutilizar os dados. O gateway continua na porta 8080; os nós não publicam mais portas no host para evitar o acesso direto de clientes. A comunicação interna usa as mesmas portas e nomes DNS do Compose. Se houver outra instância usando a porta 8080, pare-a antes de iniciar esta versão. **Não use `docker compose down -v` se quiser preservar os dados.**

**Importante:** alterar `ADMIN_PASSWORD` no `.env` após a criação inicial do banco não modifica a senha já cadastrada. Não apague o volume para trocar a senha, pois isso também elimina a configuração persistida do gateway. Não há tela de recuperação de senha nesta versão.

Para encerrar sem remover os volumes:

```powershell
docker compose down
```

## Desenvolvimento do frontend

Com Node.js 22 instalado e os serviços Docker em execução, em outro terminal:

```powershell
cd frontend
npm install
npm run dev
```

Abra http://localhost:5173. O Vite encaminha `/api` para `http://127.0.0.1:8080`. É possível mudar o destino com a variável `GATEWAY_URL`. Para compilar manualmente: `npm run build` dentro de `frontend` (ou `npm run frontend:build` na raiz).

## Estrutura

```text
Leilao-Distribuido/
├── backend/
│   ├── src/server.js          # protocolo distribuído dos nós
│   ├── gateway/server.js      # API REST e arquivos do frontend
│   ├── gateway/auth.js        # SQLite, autenticação e sessões
│   ├── tests/cluster.test.js  # teste de integração
│   ├── scripts/test-local.sh  # consulta rápida à API
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/        # leilões, nós, eventos e modais
│   │   ├── services/api.js    # cliente REST
│   │   ├── pages/             # Login, AdminDashboard, ClientDashboard e páginas administrativas
│   │   ├── App.jsx            # sessão e seleção do painel
│   │   ├── main.jsx
│   │   └── index.css          # Tailwind CSS
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
├── .env.example              # configuração inicial (copiar para .env)
├── Dockerfile
├── docker-compose.yml
└── package.json              # comandos de conveniência
```

## Funcionalidades

- Visão geral: leilões, lances, líder, saúde dos nós e eventos recentes.
- Leilões: criar, ofertar pelo líder ou seguidor, consultar histórico (sequência, mandato e Lamport), encerrar e simular três lances no leilão selecionado.
- Laboratório: criar membro usando um contêiner reserva, renomear, desativar, simular falha, restaurar e ajustar quórum.
- Eventos: registros de coordenação, replicação e falhas.
- Atualização do painel a cada 2,2 segundos, pausada durante operações.

### Experimentos

1. Com 3 membros e quórum 2, pause o Nó 3, aguarde o Nó 2 assumir e registre novo lance. Restaure o Nó 3.
2. Ative os nós 4 e 5 e observe a eleição e sincronização do histórico.
3. Com cinco membros, ajuste o quórum para 5 e pause um membro. Novos lances devem ser bloqueados.
4. Restaure o membro e desative um nó após restabelecer o quórum; observe a eleição.
5. Crie dois leilões e selecione um deles no campo de simulação. Confira os três lances em seu histórico.

## API do gateway (porta 8080)

| Método | Rota | Acesso |
|---|---|---|
| POST | `/api/auth/register` | Público: name, email, password |
| POST | `/api/auth/login` | Público: email, password |
| GET | `/api/auth/me` | Autenticado |
| POST | `/api/auth/logout` | Revoga a sessão |

Todas as rotas a seguir exigem login. O cliente tem acesso somente a GET `/api/auctions` e POST `/api/auctions/:id/bids` (envia `amount` e `requestId`; o nome é obtido da sessão). As demais são exclusivas do administrador.

| Método | Rota | Operação |
|---|---|---|
| GET | `/api/cluster` | Estado do cluster |
| GET | `/api/auctions` | Listar leilões |
| POST | `/api/auctions` | Criar leilão: item, description, openingBid, requestId |
| POST | `/api/auctions/:id/bids` | Dar lance: bidder, amount, receiverNode (opcional), requestId |
| POST | `/api/auctions/:id/close` | Encerrar leilão |
| POST | `/api/demo` | Simular lances: auctionId (opcional) |
| GET | `/api/events` | Eventos |
| POST | `/api/nodes` | Ativar reserva: name |
| PATCH | `/api/nodes/:id` | Renomear: name |
| POST | `/api/nodes/:id/deactivate` | Desativar membro |
| POST | `/api/nodes/:id/failure` | Simular/restaurar: paused (booleano) |
| PATCH | `/api/cluster/quorum` | Alterar quórum: quorum |

## Testes

Na raiz, com Node.js 22.13 ou superior:

```powershell
npm test
```

O teste inicia seis processos em portas livres e usa dados temporários; não necessita de Docker ou dependências npm. Abrange login, cadastro, bloqueio de privilégios administrativos, identidade do lance, logout, eleição, replicação, idempotência, lances, falhas, recuperação, entrada/saída de membros, quórum, eventos e entrega estática com arquivos de teste. O workflow de CI também instala e compila o frontend.

### Validação desta entrega

- Código dos nós: lógica original preservada, com autenticação por token nas chamadas internas.
- Teste de integração Node.js: executado e aprovado (1 suíte, 0 falhas).
- Sintaxe JavaScript/JSX do frontend: verificada, sem erros.
- Build Vite/Tailwind e teste no navegador/Docker: não executados neste ambiente por falta das dependências npm locais, acesso à rede e Docker. A primeira execução no computador precisa de acesso ao npm e ao registry de imagens Docker.

## Limitações originais

Sistema acadêmico para execução local, não um serviço de leilões monetários em produção. Não implementa Raft/Paxos ou garantias formais de consenso. A reconfiguração é coordenada pelo gateway, requer quórum atual e os cinco contêineres acessíveis. Criar nó ativa um slot existente; não cria um novo contêiner. Renomear não altera o ID nem DNS. A simulação de falha pausa o protocolo; não encerra o contêiner. O quórum nunca é inferior à maioria e deve ser restabelecido antes de reconfigurações. As rotas internas dos nós são protegidas por token configurado no `.env`; não exponha o sistema publicamente. Após timeout de lance, consulte o histórico antes de reenviar. A autenticação foi projetada para o ambiente acadêmico local em HTTP; uma implantação real exige HTTPS, cookies Secure, gestão de segredos, recuperação de conta, auditoria e revisão de segurança.
