import 'reflect-metadata';
import { Body, Controller, Get, Headers, Module, Param, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { GameService } from './game.service';

@Controller('api/v1')
class GameController {
  constructor(private readonly game:GameService) {}
  @Get('health') health(){return this.game.health();}
  @Post('sessions') create(){return this.game.create();}
  @Post('sessions/join') join(@Body() b:unknown){return this.game.join(b);}
  @Get('sessions/:id') read(@Param('id') id:string,@Headers('authorization') token?:string){return this.game.session(id,token);}
  @Post('sessions/:id/character') character(@Param('id') id:string,@Headers('authorization') token:string,@Body() b:unknown){return this.game.session(id,token,'character',b);}
  @Post('sessions/:id/start') start(@Param('id') id:string,@Headers('authorization') token:string){return this.game.session(id,token,'start');}
  @Post('sessions/:id/choices') choices(@Param('id') id:string,@Headers('authorization') token:string,@Body() b:unknown){return this.game.session(id,token,'choices',b);}
  @Post('sessions/:id/advance') advance(@Param('id') id:string,@Headers('authorization') token:string,@Body() b:unknown){return this.game.session(id,token,'advance',b);}
}
@Module({controllers:[GameController],providers:[GameService]})
class AppModule {}
export async function createApp() {
  if(!process.env.FRONTEND_ORIGIN) throw new Error('FRONTEND_ORIGIN is required');
  const origins=process.env.FRONTEND_ORIGIN.split(',').map(s=>s.trim()).filter(Boolean);
  for(const origin of origins) { const url=new URL(origin); if(url.origin!==origin || !['http:','https:'].includes(url.protocol)) throw new Error('FRONTEND_ORIGIN must contain exact origins without trailing slashes'); }
  if(process.env.NODE_ENV!=='production') origins.push('http://localhost:3000','http://localhost:5173');
  const app=await NestFactory.create(AppModule,{bodyParser:false,logger:process.env.NODE_ENV==='test'?false:undefined});
  app.use(json({limit:'16kb'}));
  app.enableCors({origin:origins,methods:['GET','POST','OPTIONS'],allowedHeaders:['Authorization','Content-Type'],maxAge:600});
  app.use((_req:any,res:any,next:()=>void)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
  app.enableShutdownHooks();
  return app;
}
