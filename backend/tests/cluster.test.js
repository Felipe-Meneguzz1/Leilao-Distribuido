'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function free() { return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});}); }
test('Cinco nós, Bully, lances, replicação, falhas, recuperação, membros, quórum e gateway', {timeout:135000}, async()=>{
  const temp=fs.mkdtempSync(path.join(tmpdir(),'atrio-test-'));
  const frontend=path.join(temp,'frontend');fs.mkdirSync(path.join(frontend,'assets'),{recursive:true});
  fs.writeFileSync(path.join(frontend,'index.html'),'<title>Átrio</title><div id="root">Visão geral</div>');
  fs.writeFileSync(path.join(frontend,'assets','test.js'),'console.log("Átrio");');
  const ports=new Set();while(ports.size<6)ports.add(await free());
  const [gatewayPort,...nodePorts]=ports;
  const cluster=nodePorts.map((p,i)=>`${i+1}=http://127.0.0.1:${p}`).join(',');
  const jobs=[], debug=[];
  function start(id){const child=spawn(process.execPath,[path.join(root,id===0?'gateway/server.js':'src/server.js')],{env:{...process.env,PORT:String(id===0?gatewayPort:nodePorts[id-1]),NODE_ID:String(id),DATA_DIR:path.join(temp,'node'+id),CLUSTER_NODES:cluster,CLUSTER_INITIAL_ACTIVE:'1,2,3',CONTROL_TOKEN:'testing-local',ADMIN_EMAIL:'admin@atrio.local',ADMIN_PASSWORD:'TestAdmin123!',FRONTEND_DIST:frontend},stdio:['ignore','pipe','pipe']});jobs.push(child);child.stdout.on('data',b=>debug.push(String(b)));child.stderr.on('data',b=>debug.push(String(b)));}
  let adminCookie = '';
  async function api(route,method='GET',payload,cookie=adminCookie,extraHeaders={}){const res=await fetch(`http://127.0.0.1:${gatewayPort}${route}`,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...extraHeaders},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(7500)});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
  async function expect(route,method,payload,code=200){const r=await api(route,method,payload);assert.equal(r.status,code,JSON.stringify(r.data));return r.data;}
  const state=()=>expect('/api/cluster','GET');
  const list=()=>expect('/api/auctions','GET').then(x=>x.auctions);
  const ctl=(id,paused)=>expect(`/api/nodes/${id}/failure`,'POST',{paused});
  const quorum=q=>expect('/api/cluster/quorum','PATCH',{quorum:q});
  async function until(fn,label,ms=18000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return;}catch{}await sleep(180);}throw Error(label+'\n'+debug.slice(-10).join(''));}
  const elect=(id,count)=>until(async()=>{const c=await state();return c.leaderId===id&&c.liveCount===count&&c.majority;},'Eleição '+id);
  try{
    [1,2,3,4,5,0].forEach(start);
    await until(async()=> (await api('/api/auctions','GET',undefined,'')).status===401,'Gateway disponível');
    assert.equal((await api('/api/auth/login','POST',{email:'admin@atrio.local',password:'errada123'},'')).status,401);
    const login=await api('/api/auth/login','POST',{email:'admin@atrio.local',password:'TestAdmin123!'},'');
    assert.equal(login.status,200);assert.equal(login.data.user.role,'admin');adminCookie=login.cookie;
    const reg=await api('/api/auth/register','POST',{name:'Cliente teste',email:'cliente@atrio.local',password:'Client123!',role:'admin'},'');
    assert.equal(reg.status,201,JSON.stringify(reg.data));assert.equal(reg.data.user.role,'client');const clientCookie=reg.cookie;
    assert.equal((await api('/api/auth/register','POST',{name:'Cliente teste',email:'cliente@atrio.local',password:'Client123!'},'')).status,409);
    assert.equal((await api('/api/auth/me','GET',undefined,clientCookie)).data.user.role,'client');
    assert.equal((await api('/api/auctions','GET',undefined,clientCookie)).status,200);
    for(const [route,method,payload] of [['/api/cluster','GET'],['/api/events','GET'],['/api/auctions','POST',{item:'Proibido'}],['/api/demo','POST',{}],['/api/nodes','POST',{}],['/api/nodes/1','PATCH',{}],['/api/nodes/1/failure','POST',{}],['/api/nodes/1/deactivate','POST',{}],['/api/cluster/quorum','PATCH',{}],['/api/auctions/fake/close','POST',{}]]) {
      assert.equal((await api(route,method,payload,clientCookie)).status,403,route);
    }
    assert.equal((await api('/api/auth/login','POST',{email:'admin@atrio.local',password:'TestAdmin123!'},'',{origin:'https://evil.example'})).status,403);
    await elect(3,3);
    assert.equal((await state()).capacity,5);
    const created=await expect('/api/auctions','POST',{item:'Notebook gamer',openingBid:100,description:'Teste',requestId:'create-test'},201);const id=created.auction.id;
    assert.equal(created.auction.highestBid,100);
    const bid=(bidder,amount,requestId,receiverNode,code=200)=>expect(`/api/auctions/${id}/bids`,'POST',{bidder,amount,requestId,receiverNode},code);
    await bid('Ana',150,'ana-1',1);await bid('Bruno',200,'bruno-1',2);
    await until(async()=>{const all=await Promise.all(nodePorts.slice(0,3).map(async p=>(await (await fetch(`http://127.0.0.1:${p}/auctions`,{headers:{'x-control-token':'testing-local'}})).json()).auctions[0]));return all.every(a=>a?.bids.length===2&&a.highestBid===200);},'Replicação');
    await expect('/api/nodes/1','PATCH',{name:'Entrada principal'});assert.equal((await state()).nodes[0].name,'Entrada principal');
    await quorum(3);assert.equal((await state()).quorum,3);await expect('/api/cluster/quorum','PATCH',{quorum:1},400);await quorum(2);
    assert.equal((await bid('Ana',150,'ana-1')).duplicate,true);
    await ctl(3,true);await elect(2,2);assert.equal((await bid('Carla',250,'carla-1',1)).auction.bids.length,3);
    await ctl(3,false);await elect(3,3);await until(async()=>{const a=(await (await fetch(`http://127.0.0.1:${nodePorts[2]}/auctions`,{headers:{'x-control-token':'testing-local'}})).json()).auctions[0];return a?.bids.length===3&&a.highestBid===250;},'Recuperação');
    const extra=await expect('/api/auctions','POST',{item:'PlayStation 5',openingBid:500,requestId:'create-ps5'},201);
    const direct=await fetch(`http://127.0.0.1:${nodePorts[0]}/auctions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item:'Invasão',openingBid:1})});assert.equal(direct.status,403);
    const clientBid=await api(`/api/auctions/${extra.auction.id}/bids`,'POST',{amount:525,bidder:'Outro nome',receiverNode:99,requestId:'client-test'},clientCookie);
    assert.equal(clientBid.status,200,JSON.stringify(clientBid.data));assert.equal(clientBid.data.auction.winner,'Cliente teste');
    assert.equal((await api('/api/auth/logout','POST',{},clientCookie)).status,200);
    assert.equal((await api('/api/auctions','GET',undefined,clientCookie)).status,401);
    const relogin=await api('/api/auth/login','POST',{email:'cliente@atrio.local',password:'Client123!'},'');assert.equal(relogin.status,200);assert.equal(relogin.data.user.role,'client');
    const demo=await expect('/api/demo','POST',{auctionId:extra.auction.id});assert.equal(demo.auctionId,extra.auction.id);assert.equal(demo.results.length,3);assert.equal((await list()).find(a=>a.id===extra.auction.id).bids.length,4);
    await expect('/api/nodes','POST',{name:'Servidor de apoio'},201);await elect(4,4);assert.equal((await state()).quorum,3);await bid('Elisa',300,'elisa-1');
    await expect('/api/nodes','POST',{name:'Servidor extra'},201);await elect(5,5);await quorum(5);await ctl(1,true);await bid('Fora do quorum',320,'blocked-5',undefined,503);await ctl(1,false);await elect(5,5);await quorum(3);
    await expect('/api/nodes','POST',{name:'Sexto nó'},409);await expect('/api/nodes/5/deactivate','POST',{});await elect(4,4);await expect('/api/nodes/4/deactivate','POST',{});await elect(3,3);await quorum(2);
    const closed=await expect(`/api/auctions/${id}/close`,'POST',{requestId:'close-1'});assert.equal(closed.auction.status,'encerrado');await bid('Diego',350,'after-close',undefined,409);
    await ctl(2,true);await ctl(3,true);await expect('/api/auctions','POST',{item:'Outro produto',openingBid:50},503);assert.ok((await expect('/api/events','GET')).events.length>0);
    const html=await fetch(`http://127.0.0.1:${gatewayPort}/`);assert.equal(html.status,200);assert.match(await html.text(),/Visão geral/);
    const asset=await fetch(`http://127.0.0.1:${gatewayPort}/assets/test.js`);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/assets/missing.js`)).status,404);
  }finally{await Promise.all(jobs.map(async c=>{if(c.exitCode!==null)return;const ended=new Promise(r=>c.once('exit',r));c.kill('SIGTERM');await Promise.race([ended,sleep(1500)]);if(c.exitCode===null)c.kill('SIGKILL');}));fs.rmSync(temp,{recursive:true,force:true});}
});
