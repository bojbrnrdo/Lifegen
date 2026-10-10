import { query, directClient } from './db.js';
export const revision=async()=>Number((await query('SELECT COALESCE(max(id),0) AS revision FROM app_events')).rows[0].revision);
export async function streamEvents(req,res) {
 const client=directClient();await client.connect();
 let closed=false,heartbeat,deadline;
 const close=async()=>{if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(deadline);await client.end().catch(()=>{});if(!res.writableEnded)res.end();};
 try {
  // Listen first, then send the current durable revision: changes during reconnect are covered.
  await client.query('LISTEN lifegen_changes');
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
  res.write('retry: 1500\n\n');
  const send=(name,data)=>{if(!closed&&!res.writableEnded)res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);};
  client.on('notification',n=>{try{const data=JSON.parse(n.payload);send('change',data);}catch{}});
  client.on('error',()=>close());
  send('sync',{revision:await revision()});
  heartbeat=setInterval(()=>{if(!closed)res.write(': heartbeat\n\n');},12000);
  const seconds=Math.min(50,Math.max(10,Number(process.env.SSE_MAX_SECONDS)||45));
  deadline=setTimeout(()=>{send('reconnect',{});close();},seconds*1000);
  req.on('close',close);res.on('close',close);
  await new Promise(resolve=>res.once('close',resolve));
 } catch(e) {await close();throw e;}
}
