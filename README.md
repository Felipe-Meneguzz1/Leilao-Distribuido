# TetraLeitão Leilão Online Distribuído

Projeto acadêmico desenvolvido para a disciplina de **Sistemas Distribuídos (2026)**. O sistema permite criar leilões, registrar lances e acompanhar os resultados enquanto diferentes servidores se comunicam, elegem um líder e replicam as operações. A aplicação possui uma interface web para clientes e um painel administrativo para demonstrar falhas, recuperação e gerenciamento do cluster.

> **Finalidade:** ambiente de demonstração e estudo. Não é uma plataforma de leilões financeiros para produção.

## 1. Tecnologias utilizadas

- **Frontend:** React 18, JavaScript, Vite e Tailwind CSS.
- **Backend:** Node.js 22 e APIs REST com mensagens JSON.
- **Autenticação:** SQLite nativo do Node.js (`node:sqlite`), sessões e cookies.
- **Infraestrutura:** Docker e Docker Compose, com volumes persistentes e rede interna.
- **Mecanismos distribuídos:** eleição Bully, heartbeat, relógio lógico de Lamport, log replicado e quórum de escrita.

## 2. Arquitetura do sistema

O Docker Compose inicia **seis contêineres**: cinco servidores (`node1` a `node5`) e um gateway web (`dashboard`). Por padrão, os nós **1, 2 e 3** começam como membros ativos e os nós **4 e 5** ficam reservados para ativação pelo administrador. Cada nó possui seu próprio processo e volume de dados.

```text
Navegador (administrador ou cliente)
                  |
        localhost:8080
                  |
       Gateway + autenticação
                  |
       Rede interna do Docker
       /         |          \
    node1      node2       node3       [node4, node5: reservas]
           <comunicação REST>
```

O gateway recebe as solicitações da interface, verifica a sessão e as permissões e as encaminha aos nós. Quando uma operação chega a um nó seguidor, ele a encaminha ao líder. Os nós utilizam os nomes DNS do Docker, como `http://node1:3000`, informados pela variável `CLUSTER_NODES` no Compose; os endereços IP não ficam fixos no código.

A porta **8080** é a única publicada no host (`127.0.0.1:8080`). Os cinco nós ficam acessíveis apenas pela rede interna do Docker. O SQLite armazena usuários e sessões no gateway; já os leilões e os lances ficam nos logs persistidos de cada nó e são replicados entre os membros.

## 3. Como executar

**Requisitos:** Docker Desktop com o mecanismo de contêineres Linux iniciado; Git é opcional para clonar o repositório. Para executar testes sem Docker, instale Node.js **22.13 ou superior**.

No PowerShell, na raiz do projeto:

```powershell
Copy-Item .env.example .env
notepad .env
```

Altere `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `CONTROL_TOKEN` para valores próprios. Não publique o arquivo `.env` no repositório. Depois execute:

```powershell
docker compose up --build -d
docker compose ps
```

Abra **http://localhost:8080**. O primeiro administrador é criado com as credenciais definidas no `.env`. Para experimentar o perfil cliente, utilize outra janela do navegador (ou janela anônima) e escolha a opção de cadastro.

Para acompanhar os registros dos serviços:

```powershell
docker compose logs -f
```

Para parar os serviços **sem apagar os dados**:

```powershell
docker compose down
```

**Atenção:** `docker compose down -v` apaga os volumes, incluindo lances e contas. Alterar `ADMIN_PASSWORD` no `.env` após a criação do administrador não redefine a senha salva no SQLite; esta versão não possui recuperação de senha pela interface.

## 4. Funcionalidades

**Administrador:** visualiza a situação do cluster e os eventos, cria e encerra leilões, registra ou simula lances, escolhe o leilão para a rodada automática, ativa nós reservas, renomeia e desativa membros, simula falhas e ajusta o quórum.

**Cliente:** cria sua conta, entra no sistema, consulta os leilões e seus históricos e envia lances usando o nome vinculado à sessão. O cliente não tem permissão para criar ou encerrar leilões nem para gerenciar o cluster. A autorização é conferida no gateway, não somente na interface.

O painel administrativo apresenta o líder atual, os membros disponíveis, os relógios lógicos, a situação do quórum e eventos recentes. Os dados são atualizados periodicamente.

## 5. Como funciona a distribuição

### Eleição de líder e heartbeat

O projeto usa o **algoritmo Bully**. Entre os participantes ativos, o nó de maior identificador tem prioridade para liderar. Assim, no início, o líder esperado é o **Nó 3**. Quando ele deixa de responder, os demais podem iniciar uma eleição; com os nós 1 e 2 disponíveis, o Nó 2 tende a assumir. Se o Nó 4 ou 5 for ativado, ele poderá assumir a liderança por ter ID maior.

O líder envia mensagens periódicas de **heartbeat**. A falta de contato dentro do intervalo de detecção pode disparar uma nova eleição. Os mandatos são identificados pelo campo `term`.

### Relógio lógico e ordenação

Cada nó mantém um relógio lógico de **Lamport**, atualizado durante os eventos e as trocas de mensagens. Para manter a mesma sequência dos leilões, o líder atribui um número `seq` a cada operação no log. O campo `requestId` permite identificar requisições repetidas e reduzir o risco de duplicidade.

### Replicação e quórum

Ao criar, encerrar ou receber um lance, o líder valida a solicitação e envia uma proposta aos demais nós (`/internal/prepare`). Em seguida, solicita o registro (`/internal/commit`). A resposta de confirmação depende do quórum configurado. Um nó que retorna pode consultar um servidor atualizado e sincronizar seu histórico.

**Importante sobre consistência:** a versão atual permite configurar o quórum de **1 a 5**, inclusive abaixo da maioria dos membros. Para a demonstração com três nós, o quórum de maioria é **2**; com cinco nós, é **3**. Quóruns inferiores à maioria aumentam a possibilidade de aceitar escritas com menos nós disponíveis, mas **não garantem a sobreposição entre confirmações** e podem gerar risco de inconsistência sob partições e eleições concorrentes. O projeto não implementa um consenso formal como Raft ou Paxos.

### Administração dos membros

O botão de criação ativa um dos contêineres já preparados; ele **não cria contêineres ilimitados**. Renomear altera o nome exibido, sem modificar o identificador nem o endereço DNS. Para mudanças de configuração, o gateway precisa se comunicar com todos os cinco contêineres, mesmo os que não são membros ativos. Uma falha simulada suspende a participação do nó no protocolo, mas não desliga fisicamente seu contêiner.

## 6. Roteiro de demonstração

Este roteiro cobre os principais requisitos da disciplina e pode ser executado pelo painel:

1. Inicie o Docker e entre como administrador em `http://localhost:8080`.
2. Abra uma sessão de cliente em outra janela do navegador e registre um lance em um leilão criado pelo administrador.
3. No painel, mostre os três membros iniciais, o líder atual e os eventos.
4. Mantenha três membros com **quórum 2**; simule a falha do Nó 3 e aguarde a eleição do Nó 2.
5. Envie outro lance pelo cliente e observe que o leilão continua funcionando com os dois membros disponíveis.
6. Restaure o Nó 3 e observe o retorno e a sincronização.
7. Ative um nó reserva, acompanhe a nova eleição e experimente aumentar o quórum para bloquear escritas quando as confirmações exigidas não forem alcançadas.
8. Crie dois leilões, selecione um deles em **Simular no leilão** e confira o histórico de três lances gerados automaticamente.

Para demonstrar a **queda real de um contêiner**, em vez de somente a falha simulada, use:

```powershell
docker compose stop node3
# Aguarde a eleição; consulte o painel e teste um novo lance
docker compose start node3
```

A indisponibilidade real do contêiner deve ser demonstrada com os membros e o quórum adequados. Enquanto algum contêiner estiver desligado, determinadas operações administrativas de reconfiguração poderão ser bloqueadas. O gateway permanece sendo um componente central: sua queda impede o acesso pela interface, embora os nós sejam processos separados.

## 7. Protocolo REST e formato das mensagens

As comunicações usam **HTTP e JSON**. Chamadas internas feitas pelo gateway e pelos nós enviam o cabeçalho `x-control-token`, configurado via `CONTROL_TOKEN`. O endpoint `/health` pode ser consultado sem esse token.

**Mensagens internas entre nós:**

| Método e rota | Papel |
| --- | --- |
| `POST /internal/election` | Inicia/propaga eleição, com `from` e `term`. |
| `POST /internal/leader` | Anuncia líder, com `leaderId`, `term` e `lamport`. |
| `POST /internal/heartbeat` | Informa `leaderId`, `term`, `seq` e `lamport`. |
| `GET /internal/state` | Retorna `nodeId`, `term`, `clock` e `log`. |
| `POST /internal/prepare` | Envia uma proposta de registro no campo `entry`. |
| `POST /internal/commit` | Envia o registro `entry` para confirmação. |

Exemplo de heartbeat (valores ilustrativos):

```json
{
  "leaderId": 3,
  "term": 5,
  "seq": 12,
  "lamport": 87
}
```

Exemplo de proposta para registrar um lance em `/internal/prepare` (o mesmo formato `entry` é usado em `/internal/commit`):

```json
{
  "entry": {
    "seq": 13,
    "kind": "bid",
    "requestId": "lance-exemplo-001",
    "term": 5,
    "leaderId": 3,
    "lamport": 88,
    "at": "2026-11-25T14:00:00.000Z",
    "auctionId": "LEILAO-001",
    "bidder": "Ana",
    "cents": 25000
  }
}
```

Os valores monetários dos registros internos são armazenados em **centavos** (`cents`). Os tipos de registro são `create` (criação), `bid` (lance) e `close` (encerramento). Nas respostas, códigos como **400** indicam dados inválidos, **403** acesso negado, **409** conflito de estado e **503** indisponibilidade ou ausência de quórum.

**Mensagens administrativas internas:**

- `GET /_admin/state`: situação de um nó, nome, participação, líder, term, seq, Lamport e eventos.
- `POST /_admin/bootstrap`: prepara a reentrada de um nó usando `sourceId`.
- `POST /_admin/config`: distribui uma configuração (`config`) com `epoch`, `activeIds`, `writeQuorum` e `names`.
- `POST /_admin/failure`: simula ou encerra falha com `{"paused": true}` ou `{"paused": false}`.

**Rotas principais do gateway, acessíveis pelo painel:**

| Método e rota | Operação | Permissão |
| --- | --- | --- |
| `POST /api/auth/register` e `POST /api/auth/login` | Cadastro e login | Pública |
| `GET /api/auth/me` e `POST /api/auth/logout` | Sessão e saída | Autenticado |
| `GET /api/auctions` | Lista leilões | Cliente e administrador |
| `POST /api/auctions/:id/bids` | Envia um lance | Cliente e administrador |
| `POST /api/auctions` e `POST /api/auctions/:id/close` | Cria e encerra leilão | Administrador |
| `GET /api/cluster` e `GET /api/events` | Estado do cluster e eventos | Administrador |
| `POST /api/demo` | Simulação de lances em `auctionId` | Administrador |
| `POST /api/nodes` | Ativa nó reserva | Administrador |
| `POST /api/nodes/:id/activate` | Reativa um membro | Administrador |
| `PATCH /api/nodes/:id` e `POST /api/nodes/:id/deactivate` | Renomeia ou desativa | Administrador |
| `POST /api/nodes/:id/failure` | Controla falha simulada | Administrador |
| `PATCH /api/cluster/quorum` | Altera quórum | Administrador |

O **documento de protocolo** exigido na disciplina é uma entrega separada do README e do relatório. Ele deve detalhar, em texto, os campos de cada mensagem, as respostas e o fluxo entre os nós.

