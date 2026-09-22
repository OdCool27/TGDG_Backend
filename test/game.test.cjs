const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { Pool } = require('pg');
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL database before running integration tests.');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
process.env.FRONTEND_ORIGIN='https://date.example.net';
process.env.NODE_ENV='test';
const {createApp}=require('../dist/app');
const {migrate}=require('../dist/migrate');
const {script,sceneAt,resolve,initialFiction,ending}=require('../dist/story');
let app,base,pool;
const ids=[];
const reports=[];
const character={name:'Maya',gender:'female',hairStyle:'long_wavy',hairColor:'#3a2e39',skinTone:'#ffd1b3',outfitColor:'#ff6b8b',bodyStyle:'sweater',glasses:true,facialHair:false,roomTheme:'cozy_plants'};
async function boot() { app=await createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl(); }
async function req(path,token,body,status=200) {
  const r=await fetch(base+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
}
async function room(setup=true) {
  const h=await req('/sessions',null,{},201);ids.push(h.sessionId);
  const g=await req('/sessions/join',null,{joinCode:h.joinCode.toLowerCase()},201);
  const path='/sessions/'+h.sessionId;
  if(setup) {await req(path+'/character',h.playerToken,character,201);await req(path+'/character',g.playerToken,{...character,name:'Liam'},201);await req(path+'/start',h.playerToken,{},201);}
  return {h,g,path};
}
before(async()=>{await migrate();pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});await boot();});
after(async()=>{
  if(reports.length) writeFileSync('test/playthrough-report.json',JSON.stringify(reports,null,2)+'\n');
  await app?.close();
  if(pool){await pool.query('DELETE FROM sessions WHERE id=ANY($1::uuid[])',[ids]);await pool.end();}
});

test('create/join, setup, authorization, validation, CORS and expiry',async()=>{
  const {h,g,path}=await room(false);
  assert.match(h.sessionId,/^[a-f0-9-]{36}$/);assert.match(h.joinCode,/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  assert.notEqual(h.playerToken,g.playerToken);
  const saved=(await pool.query('SELECT * FROM sessions WHERE id=$1',[h.sessionId])).rows[0];
  assert.equal(saved.host_hash.length,64);assert.ok(!JSON.stringify(saved).includes(h.playerToken));
  await req(path,null,undefined,401);await req(path,'x'.repeat(43),undefined,401);
  await req('/sessions/join',null,{joinCode:h.joinCode},409);
  await req('/sessions/join',null,{joinCode:'00000'},400);
  await req(path+'/start',g.playerToken,{},403);await req(path+'/start',h.playerToken,{},409);
  await req(path+'/character',h.playerToken,{...character,hairColor:'#abcdef'},400);
  await req(path+'/character',h.playerToken,{...character,token:'injection'},400);
  await req(path+'/character',h.playerToken,{...character,name:'x'.repeat(17000)},413);
  const preflight=await fetch(base+'/api/v1'+path,{method:'OPTIONS',headers:{Origin:'https://date.example.net','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://date.example.net');assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
  const evil=await fetch(base+'/api/v1/health',{headers:{Origin:'https://arbitrary.run.app'}});
  assert.equal(evil.headers.get('access-control-allow-origin'),null);
  await pool.query("UPDATE sessions SET last_active=now()-interval '7 hours' WHERE id=$1",[h.sessionId]);
  await req(path,h.playerToken,undefined,410);await req('/sessions/join',null,{joinCode:h.joinCode},410);
});

test('private choices, role validation, retries and persisted restart',async()=>{
  const {h,g,path}=await room();let s=await req(path,h.playerToken);
  assert.equal(s.currentScene.choices.guest.length,0);
  assert.ok(s.currentScene.dialogue.every(d=>!('guestPrivateThought' in d)));
  const c={sceneId:s.currentScene.id,choiceId:'h0'};
  await req(path+'/choices',h.playerToken,{...c,choiceId:'g0'},400);
  await req(path+'/choices',h.playerToken,{...c,sceneId:'old'},409);
  s=await req(path+'/choices',h.playerToken,c,201);
  assert.equal(s.host.submittedChoiceId,'h0');assert.equal(s.currentOutcome,undefined);
  const hidden=await req(path,g.playerToken);
  assert.equal(hidden.host.hasSubmittedChoice,true);assert.ok(!('submittedChoiceId' in hidden.host));
  assert.equal(hidden.storyLog.length,0);assert.ok(!('currentOutcome' in hidden));
  await req(path+'/choices',h.playerToken,{...c,choiceId:'h1'},409);
  await Promise.all(Array.from({length:6},()=>req(path+'/choices',h.playerToken,c,201)));
  await req(path+'/choices',g.playerToken,{...c,choiceId:'g1'},201);
  s=await req(path,h.playerToken);assert.equal(s.storyLog.length,1);assert.equal(s.currentOutcome.hostChoice.id,'h0');assert.equal(s.currentOutcome.guestChoice.id,'g1');
  await app.close();await boot();
  const restored=await req(path,g.playerToken);
  assert.deepEqual(restored.currentOutcome,s.currentOutcome);assert.deepEqual(restored.tonightSituation,s.tonightSituation);
});

test('two simultaneous join attempts allocate exactly one guest seat',async()=>{
  const h=await req('/sessions',null,{},201);ids.push(h.sessionId);
  const attempts=await Promise.all([0,1].map(()=>fetch(base+'/api/v1/sessions/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({joinCode:h.joinCode})})));
  assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);
});

test('all 60 paired outcomes acknowledge both actions and apply deterministic effects',()=>{
  for(let i=0;i<script.length;i++) for(let h=0;h<2;h++) for(let g=0;g<2;g++) {
    const f=initialFiction(),result=resolve(i,`h${h}`,`g${g}`,f);
    assert.equal(result.hostActionTaken,script[i].h[h][1]);assert.equal(result.guestActionTaken,script[i].g[g][1]);assert.ok(result.immediateResult.length>140);
    const again=initialFiction();assert.deepEqual(resolve(i,`h${h}`,`g${g}`,again),result);assert.deepEqual(again,f);
  }
});

test('three complete two-client playthroughs, concurrent submissions, recaps and callbacks',async()=>{
  const calm=[[1,0],[1,1],[1,1],[0,0],[0,0],[0,1],[0,0],[1,1],[0,0],[0,1],[0,0],[1,1],[0,0],[1,1],[0,0]];
  const routes=[{name:'Courteous and prepared',expected:'diplomatic',picks:script.map(()=>[0,0])},{name:'Rushed and improvised',expected:'chaos',picks:script.map(()=>[1,1])},{name:'Quiet and independent',expected:'soulmates',picks:calm}];
  for(const route of routes) {
    const {h,g,path}=await room();let s=await req(path,h.playerToken);const scenes=[];const consequences=[];let recaps=0,words=0;
    for(let i=0;i<script.length;i++) {
      assert.equal(s.status,'in_story');const id=s.currentScene.id;scenes.push(s.currentScene.title);
      const guestView=await req(path,g.playerToken);
      words += [s.currentScene.continuity,...s.currentScene.dialogue.map(d=>d.text),s.currentScene.immediateGoal,s.currentScene.stakes,s.currentScene.decisionPrompt,...s.currentScene.choices.host.flatMap(c=>[c.label,c.description]),...guestView.currentScene.choices.guest.flatMap(c=>[c.label,c.description])].join(' ').split(/\s+/).length;
      const [hi,gi]=route.picks[i];
      await Promise.all([req(path+'/choices',h.playerToken,{sceneId:id,choiceId:`h${hi}`},201),req(path+'/choices',g.playerToken,{sceneId:id,choiceId:`g${gi}`},201),req(path+'/choices',h.playerToken,{sceneId:id,choiceId:`h${hi}`},201)]);
      s=await req(path,h.playerToken);assert.equal(s.status,'outcome_revealed');assert.equal(s.storyLog.length,i+1);
      words+=s.currentOutcome.consequence.immediateResult.split(/\s+/).length;
      if(route.expected==='chaos' && i>=5) assert.match(s.tonightSituation.customFacts.find(f=>f.id==='laptop').value,/Wet/);
      if(route.expected==='chaos' && i===5) assert.match(s.currentOutcome.consequence.immediateResult,/Without the earlier spill kit/);
      if(route.expected==='diplomatic' && i===7) assert.match(s.currentOutcome.consequence.immediateResult,/earlier courtesy/);
      consequences.push({scene:id,changes:s.currentOutcome.consequence.tangibleChanges});
      const oldPhase=s.phaseId;
      await req(path+'/advance',h.playerToken,{ready:true,phaseId:oldPhase},201);
      assert.equal((await req(path,g.playerToken)).status,'outcome_revealed');
      s=await req(path+'/advance',g.playerToken,{ready:true,phaseId:oldPhase},201);
      await req(path+'/advance',h.playerToken,{ready:true,phaseId:oldPhase},201);
      if(i%5===4) {
        assert.equal(s.status,'chapter_recap');recaps++;assert.equal(s.chapterRecap.bulletPoints.length,5);
        s=await req(path,h.playerToken);assert.equal(s.host.readyToAdvance,false,'stale outcome retry cannot ready recap');
        const phaseId=s.phaseId;
        await req(path+'/advance',h.playerToken,{ready:true,phaseId},201);
        s=await req(path+'/advance',g.playerToken,{ready:true,phaseId},201);
      }
    }
    assert.equal(recaps,3);assert.equal(s.status,'ended');assert.equal(s.ending.id,route.expected);assert.equal(s.storyLog.length,15);
    await req('/sessions/join',null,{joinCode:h.joinCode},409);
    words+=s.ending.narrative.split(/\s+/).length;
    reports.push({route:route.name,scenes,pairedDecisions:15,chapterRecaps:recaps,ending:s.ending.title,encounteredWords:words,readingMinutesAt200Wpm:Math.round(words/200),estimatedPlayMinutes:[Math.round(words/220+5),Math.round(words/180+10)],finalSituation:s.tonightSituation,consequences});
  }
  assert.equal(new Set(reports.map(r=>r.ending)).size,3);
});
