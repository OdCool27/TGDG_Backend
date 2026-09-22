import { Injectable, HttpException, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { database } from './db';
import { CharacterCustomization, CurrentOutcomeData, PlayerRole, SessionPlayer, SessionResponse, StoryLogItem } from './contracts';
import { Fiction, initialFiction, sceneAt, script, resolve, situation, ending } from './story';

const fail = (status: number, message: string): never => { throw new HttpException(message,status); };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const characterSchema = z.object({
  name:z.string().trim().min(1).max(18).regex(/^[^\p{C}<>]+$/u),
  gender:z.enum(['male','female']),
  hairStyle:z.enum(['fade','short_casual','messy_waves','man_bun','beanie','long_wavy','bob','ponytail','curly_afro','bangs','curly','messy','bun','slick']),
  hairColor:z.enum(['#3a2e39','#e67e22','#f1c40f','#9b59b6','#e74c3c','#1a1a24']),
  skinTone:z.enum(['#ffd1b3','#f0b68a','#bb8056','#7a4933']),
  outfitColor:z.enum(['#ff6b8b','#6c5ce7','#00b894','#fdcb6e','#e17055','#2d3436']),
  bodyStyle:z.enum(['casual_hoodie','sweater','collared','tee']),glasses:z.boolean(),facialHair:z.boolean().optional(),
  roomTheme:z.enum(['cozy_plants','neon_gamer','warm_books','city_glow'])
}).strict();
function parse<T>(schema:z.ZodType<T>, input:unknown):T { const r=schema.safeParse(input); if(!r.success) return fail(400,r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')); return r.data; }
interface State {
  version:1; revision:number; index:number; phase:string; status:SessionResponse['status'];
  host:SessionPlayer; guest?:SessionPlayer; choices:Partial<Record<PlayerRole,string>>;
  ready:Record<PlayerRole,boolean>; fiction:Fiction; log:StoryLogItem[]; outcome?:CurrentOutcomeData;
  // Saved scene freezes its callback text across submissions and restarts.
  scene?:SessionResponse['currentScene'];
}
interface Row {id:string;join_code:string;host_hash:string;guest_hash:string|null;state:State;expired:boolean;}
function player(role:PlayerRole):SessionPlayer {
  return {id:randomUUID(),role,name:role==='host'?'Jordan':'Taylor',isReady:false,hasSubmittedChoice:false,readyToAdvance:false,character:{name:role==='host'?'Jordan':'Taylor',gender:role==='host'?'female':'male',hairStyle:role==='host'?'long_wavy':'short_casual',hairColor:'#3a2e39',skinTone:'#ffd1b3',outfitColor:'#ff6b8b',bodyStyle:'sweater',glasses:false,facialHair:false,roomTheme:'cozy_plants'}};
}

@Injectable()
export class GameService implements OnModuleDestroy {
  readonly pool=database();
  async onModuleDestroy() { await this.pool.end(); }
  async health() { await this.pool.query('SELECT 1'); return {status:'ok',version:'1.0.0',timestamp:new Date().toISOString()}; }
  async create() {
    const token=randomBytes(32).toString('base64url');
    for(let attempt=0;attempt<12;attempt++) {
      const id=randomUUID(), alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code=Array.from({length:5},()=>alphabet[randomInt(alphabet.length)]).join('');
      const state:State={version:1,revision:0,index:0,phase:randomUUID(),status:'lobby',host:player('host'),choices:{},ready:{host:false,guest:false},fiction:initialFiction(),log:[]};
      const r=await this.pool.query('INSERT INTO sessions(id,join_code,host_hash,state) VALUES ($1,$2,$3,$4) ON CONFLICT (join_code) DO NOTHING RETURNING id',[id,code,hash(token),state]);
      if(r.rowCount) return {sessionId:id,joinCode:code,playerToken:token,playerRole:'host'};
    }
    return fail(503,'Unable to allocate a join code. Please retry.');
  }
  private async transaction<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T> {
    const c=await this.pool.connect();
    try { await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result; }
    catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  private async save(c:PoolClient,row:Row) {
    row.state.revision++;
    await c.query('UPDATE sessions SET state=$2,guest_hash=$3,last_active=now() WHERE id=$1',[row.id,row.state,row.guest_hash]);
  }
  async join(body:unknown) {
    const {joinCode}=parse(z.object({joinCode:z.string().trim().toUpperCase().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/)}).strict(),body);
    return this.transaction(async c=>{
      const r=await c.query<Row>("SELECT *, last_active < now()-interval '6 hours' AS expired FROM sessions WHERE join_code=$1 FOR UPDATE",[joinCode]);
      const row=r.rows[0];
      if(!row) return fail(404,'Join code not found. Check the five-character code.');
      if(row.expired) return fail(410,'This session expired after six hours of inactivity.');
      if(row.state.status==='ended') return fail(409,'This date has already ended.');
      if(row.guest_hash) return fail(409,'This session already has two players.');
      if(row.state.status!=='lobby') return fail(409,'This date has already started.');
      const token=randomBytes(32).toString('base64url');
      row.guest_hash=hash(token); row.state.guest=player('guest'); await this.save(c,row);
      return {sessionId:row.id,playerToken:token,playerRole:'guest'};
    });
  }
  async session(id:string,authorization:string|undefined,action='read',body?:unknown) {
    parse(z.string().uuid(),id);
    const match=authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if(!match) return fail(401,'A valid player bearer token is required.');
    const tokenHash=hash(match[1]);
    return this.transaction(async c=>{
      const r=await c.query<Row>("SELECT *, last_active < now()-interval '6 hours' AS expired FROM sessions WHERE id=$1 FOR UPDATE",[id]);
      const row=r.rows[0];
      if(!row) return fail(404,'Session not found.');
      const role:PlayerRole=row.host_hash===tokenHash?'host':row.guest_hash===tokenHash?'guest':fail(401,'This token does not belong to this session.');
      if(row.expired) return fail(410,'This session expired after six hours of inactivity.');
      const s=row.state;
      if(s.version!==1) return fail(409,'This session uses an unsupported story version. Please start a new date.');
      if(action==='character') {
        if(s.status!=='lobby') return fail(409,'Character setup is closed after the date starts.');
        const character=parse(characterSchema,body) as CharacterCustomization;
        Object.assign(s[role]!,{name:character.name,character,isReady:true});
      } else if(action==='start') {
        if(role!=='host') return fail(403,'Only the host can start the date.');
        if(s.status==='lobby') {
          if(!s.host.isReady || !s.guest?.isReady) return fail(409,'Both players must join and complete character setup first.');
          this.openScene(s);
        }
      } else if(action==='choices') {
        const choice=parse(z.object({sceneId:z.string(),choiceId:z.string()}).strict(),body);
        if(choice.sceneId!==s.scene?.id) return fail(409,'That scene is no longer current. Refresh and try again.');
        if(s.choices[role]) {
          if(s.choices[role]!==choice.choiceId) return fail(409,'Your choice is already locked in.');
          // Exact retries are idempotent, including after resolution.
        } else {
          if(!['in_story','choice_pending'].includes(s.status)) return fail(409,'Choices are not open in this phase.');
          if(!s.scene.choices[role].some(o=>o.id===choice.choiceId)) return fail(400,'Choose one of your own available actions.');
          s.choices[role]=choice.choiceId; s.status='choice_pending';
          if(s.choices.host && s.choices.guest) {
            const hc=s.scene.choices.host.find(o=>o.id===s.choices.host)!;
            const gc=s.scene.choices.guest.find(o=>o.id===s.choices.guest)!;
            const consequence=resolve(s.index,hc.id,gc.id,s.fiction);
            s.outcome={hostChoice:hc,guestChoice:gc,consequence,hostReadyToAdvance:false,guestReadyToAdvance:false};
            s.log.push({sceneId:s.scene.id,sceneTitle:s.scene.title,chapterNumber:s.scene.chapterNumber,hostChoiceLabel:hc.label,guestChoiceLabel:gc.label,outcomeTitle:consequence.title,immediateResult:consequence.immediateResult,tangibleChanges:consequence.tangibleChanges});
            s.status='outcome_revealed'; s.phase=randomUUID();
          }
        }
      } else if(action==='advance') {
        const advance=parse(z.object({ready:z.literal(true),phaseId:z.string().uuid()}).strict(),body);
        // A delayed double tap from an earlier phase must never ready the next recap.
        if(advance.phaseId===s.phase) {
          if(!['outcome_revealed','chapter_recap'].includes(s.status)) return fail(409,'Wait for the shared outcome before continuing.');
          s.ready[role]=true;
          if(s.ready.host && s.ready.guest) {
            if(s.status==='outcome_revealed' && s.index%5===4) {
              s.status='chapter_recap';s.phase=randomUUID();s.ready={host:false,guest:false};
            } else {
              s.index++;
              if(s.index===script.length) {s.status='ended';s.phase=randomUUID();s.ready={host:false,guest:false};}
              else this.openScene(s);
            }
          }
        }
      }
      if(action==='read') {
        // Polling is activity, but does not change the state revision.
        await c.query('UPDATE sessions SET last_active=now() WHERE id=$1',[id]);
      } else await this.save(c,row);
      return this.response(row,role);
    });
  }
  private openScene(s:State) { s.status='in_story';s.phase=randomUUID();s.choices={};s.ready={host:false,guest:false};delete s.outcome;s.scene=sceneAt(s.index,s.fiction); }
  private response(row:Row,role:PlayerRole) {
    const s=row.state, revealed=s.status==='outcome_revealed';
    const project=(p:SessionPlayer):SessionPlayer=>({id:p.id,role:p.role,name:p.name,character:p.character,isReady:p.isReady,hasSubmittedChoice:!!s.choices[p.role],readyToAdvance:s.ready[p.role],...((p.role===role || revealed)&&s.choices[p.role]?{submittedChoiceId:s.choices[p.role]}:{})});
    const scene=s.scene ? structuredClone(s.scene) : undefined;
    if(scene) {
      scene.dialogue.forEach(line=>{if(role==='host') delete line.guestPrivateThought; else delete line.hostPrivateThought;});
      // Even the other role's option text stays private until both have submitted.
      if(!revealed) scene.choices[role==='host'?'guest':'host']=[];
    }
    const chapter=Math.min(3,Math.floor(s.index/5)+1);
    const chapterLog=s.log.filter(l=>l.chapterNumber===chapter);
    return {sessionId:row.id,joinCode:row.join_code,revision:s.revision,phaseId:s.phase,status:s.status,host:project(s.host),guest:s.guest?project(s.guest):undefined,currentChapter:chapter,currentScene:s.status==='ended'?undefined:scene,submissionStatus:{hostSubmitted:!!s.choices.host,guestSubmitted:!!s.choices.guest},currentOutcome:revealed?{...s.outcome,hostReadyToAdvance:s.ready.host,guestReadyToAdvance:s.ready.guest}:undefined,tonightSituation:situation(s.fiction),previousOutcomeSummary:s.log.at(-1)?.immediateResult,storyLog:s.log,chapterRecap:s.status==='chapter_recap'?{chapterNumber:chapter,chapterTitle:s.scene!.chapterTitle,bulletPoints:chapterLog.map(l=>`${l.sceneTitle}: ${l.immediateResult}`),funnyHighlight:chapterLog.at(-1)?.outcomeTitle || ''}:undefined,ending:s.status==='ended'?ending(s.fiction):undefined,nextSceneId:revealed?(s.index+1<script.length?sceneAt(s.index+1,s.fiction).id:'ending'):undefined};
  }
}
