import 'dotenv/config';
import { createApp } from './app';
createApp().then(app=>app.listen(Number(process.env.PORT || 3001),'0.0.0.0')).catch(e=>{console.error(e);process.exitCode=1;});
