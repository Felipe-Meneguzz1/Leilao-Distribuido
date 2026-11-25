'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const NODE_ID = Number(process.env.NODE_ID || 1);
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data', `node${NODE_ID}`);
const TOKEN = process.env.CONTROL_TOKEN || 'lab-local-demo';
const PEERS = new Map((process.env.CLUSTER_NODES || '1=http://localhost:3001,2=http://localhost:3002,3=http://localhost:3003').split(',').map(s => { const i = s.indexOf('='); if (i < 1) throw Error('CLUSTER_NODES inválido'); return [Number(s.slice(0, i)), s.slice(i + 1).replace(/\/$/, '')]; }));
if (!PEERS.has(NODE_ID)) throw Error('NODE_ID ausente em CLUSTER_NODES');
const sortedIds = values => [...new Set(values)].sort((a,b)=>a-b);
const defaultMembers = sortedIds((process.env.CLUSTER_INITIAL_ACTIVE || '1,2,3').split(',').map(Number));
const validMembers = values => Array.isArray(values)&&values.length>=2&&values.every(x=>Number.isInteger(x)&&PEERS.has(x))&&new Set(values).size===values.length;
if(!validMembers(defaultMembers))throw Error('CLUSTER_INITIAL_ACTIVE inválido');
let config={epoch:0,activeIds:defaultMembers,writeQuorum:Math.floor(defaultMembers.length/2)+1,names:Object.fromEntries([...PEERS.keys()].map(id=>[id,`Nó ${id}`]))};
const minimumQuorum=()=>1;
const validQuorum=q=>Number.isInteger(q)&&q>=minimumQuorum()&&q<=Math.min(5,PEERS.size);
const quorum=()=>config.writeQuorum;
const member=()=>config.activeIds.includes(NODE_ID);
const STORE=path.join(DATA_DIR,'state.json');
fs.mkdirSync(DATA_DIR,{recursive:true});
let persisted={term:0,clock:0,log:[]};
if(fs.existsSync(STORE))persisted={...persisted,...JSON.parse(fs.readFileSync(STORE,'utf8'))};
if(persisted.config&&Number.isInteger(persisted.config.epoch)&&validMembers(persisted.config.activeIds)){
 config={...config,...persisted.config};
 if(!validQuorum(config.writeQuorum))throw Error('Quórum persistido inválido');
}
let term=Number(persisted.term)||0,clock=Number(persisted.clock)||0;
let log=Array.isArray(persisted.log)?persisted.log:[];
let leaderId=null,electionRunning=false,waitingElection=0,lastLeaderContact=0,paused=false;
const pending=new Map(),peerSeen=new Map(),events=[];
let serial=Promise.resolve();
const ids=()=>config.activeIds.filter(x=>x!==NODE_ID);
const seq=()=>log.length?log[log.length-1].seq:0;
const money=x=>Number((x/100).toFixed(2));
const failure=(status,message)=>Object.assign(new Error(message),{status});
const persist=()=>{const tmp=STORE+'.tmp';fs.writeFileSync(tmp,JSON.stringify({term,clock,log,config}));fs.renameSync(tmp,STORE);};
function tick(remote=0){clock=Math.max(clock,Number(remote)||0)+1;return clock;}
function record(type,data={}){const e={time:new Date().toISOString(),node:NODE_ID,type,...data};events.push(e);if(events.length>120)events.shift();console.log(JSON.stringify(e));}
function reply(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'Content-Type','access-control-allow-methods':'GET,POST,OPTIONS'});res.end(JSON.stringify(body));}
function parse(req){return new Promise((resolve,reject)=>{let parts=[],length=0;req.on('data',b=>{length+=b.length;if(length>32768){reject(failure(413,'Corpo muito grande'));req.destroy();}else parts.push(b);});req.on('end',()=>{try{resolve(parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{});}catch{reject(failure(400,'JSON inválido'));}});req.on('error',reject);});}
async function call(id,uri,method='GET',body,timeout=900){const base=PEERS.get(Number(id));if(!base)throw failure(400,'Nó inválido');const res=await fetch(base+uri,{method,headers:{'content-type':'application/json','x-control-token':TOKEN},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const data=await res.json().catch(()=>({}));if(!res.ok)throw failure(res.status,data.error||`HTTP ${res.status}`);peerSeen.set(Number(id),Date.now());return data;}
function amountToCents(x){const n=Number(x);if(typeof x==='boolean'||x===null||x===''||!Number.isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>1e-6||n>100000000)throw failure(400,'Informe valor positivo com até 2 casas decimais');return Math.round(n*100);}
function allAuctions(){
 const map=new Map();for(const e of log){
  if(e.kind==='create'){map.set(e.auctionId,{id:e.auctionId,item:e.item,description:e.description||'',openingBid:money(e.cents),highestBid:money(e.cents),winner:null,status:'aberto',createdAt:e.at,closedAt:null,bids:[]});}
  else if(e.kind==='bid'){const a=map.get(e.auctionId);if(a){a.highestBid=money(e.cents);a.winner=e.bidder;a.bids.push({seq:e.seq,requestId:e.requestId,bidder:e.bidder,amount:money(e.cents),term:e.term,lamport:e.lamport,at:e.at});}}
  else if(e.kind==='close'){const a=map.get(e.auctionId);if(a){a.status='encerrado';a.closedAt=e.at;}}
 }
 return [...map.values()].reverse();
}
const getAuction=id=>allAuctions().find(a=>a.id===id);
function consistentPrefix(remote){for(let i=0;i<Math.min(log.length,remote.length);i++){if(log[i].requestId!==remote[i].requestId||log[i].kind!==remote[i].kind)return false;}return true;}
function acceptLeader(id,t){if(!member()||!config.activeIds.includes(id)||!Number.isInteger(t)||t<term)return false;if(t===term&&leaderId!==null&&id<leaderId)return false;const changed=leaderId!==id||term!==t;leaderId=id;term=t;lastLeaderContact=Date.now();waitingElection=0;if(changed){record('LIDER_ATUALIZADO',{leaderId:id,term});persist();}if(id<NODE_ID&&!electionRunning)setImmediate(()=>void startElection('lider_inferior'));return true;}
async function syncFrom(id){if(paused||!member()||!config.activeIds.includes(id)||id===NODE_ID)return;try{const state=await call(id,'/internal/state','GET',undefined,1300);if(!Array.isArray(state.log))return;if(state.log.length>log.length){if(!consistentPrefix(state.log)){record('SINCRONIZACAO_CONFLITO',{from:id});return;}log=state.log;clock=Math.max(clock,state.clock||0);pending.clear();persist();record('ESTADO_SINCRONIZADO',{from:id,seq:seq()});}}catch(e){record('SINCRONIZACAO_FALHOU',{from:id,error:e.message});}}
async function becomeLeader(){
 if(paused||!member())return;const states=await Promise.all(ids().map(async id=>{try{return {id,state:await call(id,'/internal/state','GET',undefined,1000)};}catch{return null;}}));const visible=states.filter(Boolean);const candidates=[{id:NODE_ID,state:{term,log,clock}},...visible];const maxTerm=Math.max(...candidates.map(x=>x.state.term||0));const longest=candidates.sort((a,b)=>b.state.log.length-a.state.log.length)[0];if(longest.state.log.length>log.length){if(!consistentPrefix(longest.state.log)){record('ELEICAO_CONFLITO_LOG');electionRunning=false;return;}log=longest.state.log;clock=Math.max(clock,longest.state.clock||0);}
 term=maxTerm+1;leaderId=NODE_ID;lastLeaderContact=Date.now();waitingElection=0;pending.clear();persist();record('ELEITO_LIDER',{leaderId,term,seq:seq(),visiveis:visible.length+1});await Promise.all(ids().map(id=>call(id,'/internal/leader','POST',{leaderId:NODE_ID,term,lamport:tick()},700).catch(()=>null)));electionRunning=false;
}
async function startElection(reason){if(paused||!member()||electionRunning)return;electionRunning=true;waitingElection=Date.now();const higher=ids().filter(x=>x>NODE_ID);record('ELEICAO_INICIADA',{reason,higher});const answers=await Promise.all(higher.map(id=>call(id,'/internal/election','POST',{from:NODE_ID,term},650).then(()=>true).catch(()=>false)));if(!answers.some(Boolean)){try{await becomeLeader();}catch(e){record('ELEICAO_ERRO',{error:e.message});electionRunning=false;}}else{electionRunning=false;record('ELEICAO_AGUARDANDO_SUPERIOR');}}
function heartbeat(){if(paused||!member())return;if(leaderId===NODE_ID){const superior=ids().some(id=>id>NODE_ID&&peerSeen.has(id)&&Date.now()-peerSeen.get(id)<1900);if(superior&&!electionRunning&&(!waitingElection||Date.now()-waitingElection>1700))void startElection('superior_reapareceu');for(const id of ids())call(id,'/internal/heartbeat','POST',{leaderId:NODE_ID,term,seq:seq(),lamport:tick()},550).catch(()=>null);}else if(leaderId===null||Date.now()-lastLeaderContact>2600){if(!electionRunning&&(!waitingElection||Date.now()-waitingElection>1600))void startElection('heartbeat_expirado');}}
function commit(e){const previous=log[e.seq-1];if(previous){if(previous.requestId===e.requestId)return;throw failure(409,'Conflito de sequência');}if(e.seq!==seq()+1)throw failure(409,'Log desatualizado');log.push(e);tick(e.lamport);pending.delete(e.seq);persist();record('OPERACAO_CONFIRMADA',{seq:e.seq,kind:e.kind,auctionId:e.auctionId,term:e.term});}
async function execute(kind,body,auctionId){
 if(paused||!member()||leaderId!==NODE_ID)throw failure(409,'Liderança mudou');const requestId=String(body.requestId||crypto.randomUUID()).trim();if(!requestId||requestId.length>120)throw failure(400,'requestId inválido');const duplicate=log.find(x=>x.requestId===requestId);if(duplicate)return {ok:true,duplicate:true,leaderId,seq:duplicate.seq,auction:duplicate.auctionId?getAuction(duplicate.auctionId):null};const data={};
 if(kind==='create'){const item=String(body.item||'').trim();if(item.length<3||item.length>90)throw failure(400,'Produto deve ter 3 a 90 caracteres');const description=String(body.description||'').trim();if(description.length>300)throw failure(400,'Descrição muito longa');data.auctionId='LEILAO-'+crypto.randomBytes(3).toString('hex').toUpperCase();data.item=item;data.description=description;data.cents=amountToCents(body.openingBid);}
 else{const a=getAuction(auctionId);if(!a)throw failure(404,'Leilão não encontrado');if(a.status!=='aberto')throw failure(409,'Leilão encerrado');data.auctionId=auctionId;if(kind==='bid'){const bidder=String(body.bidder||'').trim();if(!bidder||bidder.length>60)throw failure(400,'Informe o nome do participante (até 60 caracteres)');data.cents=amountToCents(body.amount);if(data.cents<=Math.round(a.highestBid*100))throw failure(400,`Lance deve superar R$ ${a.highestBid.toFixed(2)}`);data.bidder=bidder;}}
 const currentTerm=term;const e={seq:seq()+1,kind,requestId,term:currentTerm,leaderId:NODE_ID,lamport:tick(),at:new Date().toISOString(),...data};
 const ready=(await Promise.all(ids().map(async id=>{try{await call(id,'/internal/prepare','POST',{entry:e},1100);return id;}catch{return null;}}))).filter(x=>x!==null);
 if(ready.length+1<quorum()||leaderId!==NODE_ID||term!==currentTerm)throw failure(503,'Sem quórum para preparar a operação');
 const ack=(await Promise.all(ready.map(async id=>{try{await call(id,'/internal/commit','POST',{entry:e},1100);return id;}catch{return null;}}))).filter(x=>x!==null);
 if(ack.length+1<quorum()||leaderId!==NODE_ID||term!==currentTerm)throw failure(503,'Sem quórum para confirmar a operação');
 commit(e);record('QUORUM_ATINGIDO',{seq:e.seq,acks:ack.length+1});return {ok:true,leaderId,term,seq:e.seq,auction:getAuction(e.auctionId)};
}
async function operation(kind,body,auctionId){
 if(!member())throw failure(503,'Nó fora da configuração ativa');if(leaderId===null)throw failure(503,'Aguardando eleição de líder');if(leaderId!==NODE_ID){try{return await call(leaderId,kind==='create'?'/auctions':kind==='bid'?`/auctions/${encodeURIComponent(auctionId)}/bids`:`/auctions/${encodeURIComponent(auctionId)}/close`,'POST',body,4800);}catch(e){throw failure(e.status===400||e.status===409||e.status===404?e.status:503,`Encaminhamento ao líder: ${e.message}`);}}
 const job=serial.then(()=>execute(kind,body,auctionId));serial=job.catch(()=>{});return job;
}
async function handle(req,res){
 if(req.method==='OPTIONS')return reply(res,204,{});const u=new URL(req.url,`http://localhost:${PORT}`),r=u.pathname;
 if(r!=='/health'&&req.headers['x-control-token']!==TOKEN)throw failure(403,'Acesso interno negado');
 // As rotas administrativas permanecem disponíveis durante falhas simuladas.
 if(r.startsWith('/_admin/')){
  if(req.headers['x-control-token']!==TOKEN)throw failure(403,'Acesso administrativo negado');
  if(req.method==='GET'&&r==='/_admin/state')return reply(res,200,{nodeId:NODE_ID,paused,member:member(),name:config.names[NODE_ID],leaderId,term,lamport:clock,seq:seq(),quorum:quorum(),configEpoch:config.epoch,activeIds:config.activeIds,events:events.slice(-35)});
  if(req.method==='POST'&&r==='/_admin/bootstrap'){
   const b=await parse(req),sourceId=Number(b.sourceId);
   if(!config.activeIds.includes(sourceId)||sourceId===NODE_ID)throw failure(400,'Fonte de sincronização inválida');
   const remote=await call(sourceId,'/internal/state','GET',undefined,2400);
   if(!Array.isArray(remote.log)||!consistentPrefix(remote.log)||remote.log.length<log.length)throw failure(409,'Log não é prefixo do estado da fonte; reentrada bloqueada');
   log=remote.log;clock=Math.max(clock,remote.clock||0);term=Math.max(term,remote.term||0);pending.clear();persist();record('NO_PREPARADO_ENTRADA',{from:sourceId,seq:seq()});return reply(res,200,{ok:true,nodeId:NODE_ID,seq:seq()});
  }
  if(req.method==='POST'&&r==='/_admin/config'){
   const b=await parse(req),next=b.config;
   if(!next||!Number.isInteger(next.epoch)||!validMembers(next.activeIds)||!validQuorum(next.writeQuorum))throw failure(400,'Configuração ou quórum inválido');
   if(!next.names||typeof next.names!=='object'||[...PEERS.keys()].some(id=>typeof next.names[id]!=='string'||next.names[id].length<2||next.names[id].length>40))throw failure(400,'Nomes de nós inválidos');
   if(next.epoch<config.epoch)throw failure(409,'Configuração obsoleta');
   if(next.epoch===config.epoch){if(JSON.stringify(next)!==JSON.stringify(config))throw failure(409,'Conflito de versão da configuração');return reply(res,200,{ok:true,epoch:config.epoch});}
   const changed=next.activeIds.join(',')!==config.activeIds.join(',');
   config={epoch:next.epoch,activeIds:sortedIds(next.activeIds),writeQuorum:next.writeQuorum,names:next.names};
   if(changed){leaderId=null;lastLeaderContact=0;waitingElection=0;pending.clear();}
   persist();record('CONFIG_CLUSTER_ATUALIZADA',{epoch:config.epoch,activeIds:config.activeIds,quorum:quorum()});
   if(changed&&member()&&!paused)setTimeout(()=>void startElection('configuracao_alterada'),350+NODE_ID*120);
   return reply(res,200,{ok:true,epoch:config.epoch,member:member()});
  }
  if(req.method==='POST'&&r==='/_admin/failure'){const b=await parse(req);if(typeof b.paused!=='boolean')throw failure(400,'Campo paused é obrigatório');const was=paused;paused=b.paused;if(paused){leaderId=null;lastLeaderContact=0;pending.clear();waitingElection=0;record('FALHA_SIMULADA');}else if(was){leaderId=null;waitingElection=0;record('NO_RECUPERADO');setTimeout(()=>void startElection('recuperacao'),200);}return reply(res,200,{ok:true,nodeId:NODE_ID,paused});}
  throw failure(404,'Rota administrativa inválida');
 }
 if(paused||!member())throw failure(503,paused?'Nó indisponível (falha simulada)':'Nó fora da configuração ativa');
 const body=req.method==='POST'?await parse(req):{};
 if(req.method==='GET'&&r==='/health')return reply(res,200,{ok:true,nodeId:NODE_ID,leaderId,term,lamport:clock,seq:seq()});
 if(req.method==='GET'&&r==='/cluster/status')return reply(res,200,{nodeId:NODE_ID,leaderId,term,lamport:clock,seq:seq(),quorum:quorum(),minimumQuorum:minimumQuorum(),activeIds:config.activeIds,configEpoch:config.epoch,nodes:[...PEERS].map(([id,url])=>({id,name:config.names[id],url,member:config.activeIds.includes(id),isLeader:id===leaderId,lastSeenMsAgo:id===NODE_ID?0:peerSeen.has(id)?Date.now()-peerSeen.get(id):null}))});
 if(req.method==='GET'&&r==='/auctions')return reply(res,200,{auctions:allAuctions(),nodeId:NODE_ID,leaderId});
 if(req.method==='GET'&&r==='/auction')return reply(res,200,allAuctions()[0]||{error:'Nenhum leilão criado'});
 const match=r.match(/^\/auctions\/([A-Za-z0-9-]+)(?:\/(bids|close))?$/);
 if(req.method==='GET'&&match&&!match[2]){const a=getAuction(match[1]);if(!a)throw failure(404,'Leilão não encontrado');return reply(res,200,a);}
 if(req.method==='POST'&&r==='/auctions')return reply(res,201,await operation('create',body));
 if(req.method==='POST'&&match&&match[2])return reply(res,200,await operation(match[2]==='bids'?'bid':'close',body,match[1]));
 if(req.method==='GET'&&r==='/internal/state')return reply(res,200,{nodeId:NODE_ID,term,clock,log});
 if(req.method==='POST'&&r==='/internal/election'){if(Number(body.from)<NODE_ID)setImmediate(()=>void startElection('pedido_de_inferior'));return reply(res,200,{ok:true,from:NODE_ID,term});}
 if(req.method==='POST'&&r==='/internal/leader'){if(!acceptLeader(Number(body.leaderId),Number(body.term)))throw failure(409,'Anúncio de líder obsoleto');tick(body.lamport);persist();if(leaderId!==NODE_ID)setImmediate(()=>void syncFrom(leaderId));return reply(res,200,{ok:true,leaderId,term});}
 if(req.method==='POST'&&r==='/internal/heartbeat'){if(!acceptLeader(Number(body.leaderId),Number(body.term)))throw failure(409,'Heartbeat de líder obsoleto');tick(body.lamport);if(Number(body.seq)>seq())setImmediate(()=>void syncFrom(leaderId));return reply(res,200,{ok:true,seq:seq()});}
 if(req.method==='POST'&&r==='/internal/prepare'){const e=body.entry;if(!e||!Number.isInteger(e.seq)||!Number.isInteger(e.term)||!['create','bid','close'].includes(e.kind))throw failure(400,'Proposta inválida');if(!acceptLeader(Number(e.leaderId),Number(e.term)))throw failure(409,'Líder antigo');tick(e.lamport);if(e.seq!==seq()+1)throw failure(409,'Log desatualizado');const existing=pending.get(e.seq);if(existing&&existing.requestId!==e.requestId&&existing.term===e.term)throw failure(409,'Proposta concorrente');pending.set(e.seq,e);return reply(res,200,{ok:true,nodeId:NODE_ID,seq:e.seq});}
 if(req.method==='POST'&&r==='/internal/commit'){const e=body.entry;if(!e||!Number.isInteger(e.seq)||!Number.isInteger(e.term))throw failure(400,'Commit inválido');if(!acceptLeader(Number(e.leaderId),Number(e.term)))throw failure(409,'Líder antigo');commit(e);return reply(res,200,{ok:true,nodeId:NODE_ID,seq:e.seq});}
 throw failure(404,'Rota não encontrada');
}
const server=http.createServer((req,res)=>handle(req,res).catch(err=>{record('HTTP_ERRO',{route:req.url,error:err.message});if(!res.writableEnded)reply(res,err.status||500,{ok:false,error:err.message});}));
server.listen(PORT,'0.0.0.0',()=>{record('NO_INICIADO',{port:PORT,seq:seq(),quorum:quorum(),member:member()});if(member())setTimeout(()=>void startElection('inicio'),450+NODE_ID*160);setInterval(heartbeat,700).unref();});
process.on('SIGTERM',()=>{record('NO_FINALIZADO');server.close(()=>process.exit(0));});
